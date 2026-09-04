import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SplitFareRequest, SplitFareStatus } from './entities/split-fare-request.entity';
import { SplitFareParticipant, SplitParticipantStatus } from './entities/split-fare-participant.entity';
import { Ride } from '../rides/entities/ride.entity';
import { UsersService } from '../users/users.service';
import { WalletsService } from '../wallets/wallets.service';
import { TransactionCategory } from '../common/enums/transaction.enum';
import { SystemSettingsService, SETTING_KEYS } from '../settings/settings.service';

interface CreateSplitInput {
  participantPhones: string[];
  /** Explicit per-participant amounts; if omitted, the ride's total is split evenly among initiator + participants. */
  amounts?: number[];
}

@Injectable()
export class SplitFareService {
  private readonly logger = new Logger(SplitFareService.name);

  constructor(
    @InjectRepository(SplitFareRequest)
    private readonly requestsRepo: Repository<SplitFareRequest>,
    @InjectRepository(SplitFareParticipant)
    private readonly participantsRepo: Repository<SplitFareParticipant>,
    @InjectRepository(Ride)
    private readonly ridesRepo: Repository<Ride>,
    private readonly usersService: UsersService,
    private readonly walletsService: WalletsService,
    private readonly settingsService: SystemSettingsService,
    private readonly events: EventEmitter2,
  ) {}

  async create(rideId: string, initiatorId: string, input: CreateSplitInput): Promise<SplitFareRequest> {
    const ride = await this.ridesRepo.findOne({ where: { id: rideId } });
    if (!ride) throw new NotFoundException('Ride not found');
    if (ride.passengerId !== initiatorId) {
      throw new ForbiddenException('Only the passenger who booked this ride can split its fare');
    }

    const existing = await this.requestsRepo.findOne({ where: { rideId } });
    if (existing) throw new BadRequestException('This ride already has a split fare request');

    if (input.participantPhones.length === 0) {
      throw new BadRequestException('Add at least one participant to split with');
    }

    const totalFare = parseFloat(ride.totalFare);
    const headcount = input.participantPhones.length + 1; // + the initiator
    const amounts =
      input.amounts ?? input.participantPhones.map(() => Math.round((totalFare / headcount) * 100) / 100);

    if (amounts.length !== input.participantPhones.length) {
      throw new BadRequestException('amounts must have one entry per participant');
    }
    const amountsSum = amounts.reduce((sum, a) => sum + a, 0);
    if (amountsSum > totalFare) {
      throw new BadRequestException("Participant amounts can't exceed the ride's total fare");
    }

    // Resolve every phone to a real user BEFORE creating anything — v1
    // only supports splitting with people who already have a Ryda
    // account (see the entity comment); failing fast here avoids a
    // half-created split request with dangling participants.
    const resolvedUsers = await Promise.all(
      input.participantPhones.map(async (phone) => {
        const user = await this.usersService.findByPhone(phone);
        if (!user) {
          throw new BadRequestException(`${phone} doesn't have a Ryda account yet — they need one to split a fare`);
        }
        if (user.id === initiatorId) {
          throw new BadRequestException("You can't split a fare with yourself");
        }
        return user;
      }),
    );

    const expiryMinutes = await this.settingsService.getNumber(SETTING_KEYS.SPLIT_FARE_EXPIRY_MINUTES, 48 * 60);
    const request = await this.requestsRepo.save(
      this.requestsRepo.create({
        rideId,
        initiatorId,
        totalAmount: totalFare.toFixed(2),
        expiresAt: new Date(Date.now() + expiryMinutes * 60 * 1000),
      }),
    );

    await this.participantsRepo.save(
      resolvedUsers.map((user, i) =>
        this.participantsRepo.create({
          splitRequestId: request.id,
          userId: user.id,
          amountOwed: amounts[i].toFixed(2),
        }),
      ),
    );

    return this.getByRide(rideId, initiatorId);
  }

  async getByRide(rideId: string, requesterId: string): Promise<SplitFareRequest> {
    const request = await this.requestsRepo.findOne({ where: { rideId }, relations: { participants: true } });
    if (!request) throw new NotFoundException('No split fare request for this ride');

    const isParticipant = request.participants.some((p) => p.userId === requesterId);
    if (request.initiatorId !== requesterId && !isParticipant) {
      throw new ForbiddenException("You don't have access to this split fare request");
    }
    return request;
  }

  /** Called by a participant to pay their own share — debits their wallet, credits the initiator's. */
  async payShare(rideId: string, participantUserId: string): Promise<SplitFareParticipant> {
    const request = await this.requestsRepo.findOne({ where: { rideId }, relations: { participants: true } });
    if (!request) throw new NotFoundException('No split fare request for this ride');

    const participant = request.participants.find((p) => p.userId === participantUserId);
    if (!participant) throw new ForbiddenException("You're not a participant in this split fare request");
    if (participant.status === SplitParticipantStatus.PAID) {
      throw new BadRequestException('You already paid your share');
    }
    if (request.status === SplitFareStatus.EXPIRED) {
      throw new BadRequestException('This split fare request has expired');
    }

    const amount = parseFloat(participant.amountOwed);
    const participantWallet = await this.walletsService.getByUserId(participantUserId);
    const initiatorWallet = await this.walletsService.getByUserId(request.initiatorId);

    await this.walletsService.debit(
      participantWallet.id,
      amount,
      TransactionCategory.SPLIT_FARE_PAYMENT,
      request.id,
      'Split fare payment',
    );
    await this.walletsService.credit(
      initiatorWallet.id,
      amount,
      TransactionCategory.SPLIT_FARE_RECEIVED,
      request.id,
      'Split fare received',
    );

    participant.status = SplitParticipantStatus.PAID;
    participant.paidAt = new Date();
    await this.participantsRepo.save(participant);

    const allPaid = request.participants.every((p) => p.userId === participantUserId || p.status === SplitParticipantStatus.PAID);
    if (allPaid) {
      request.status = SplitFareStatus.COMPLETED;
      await this.requestsRepo.save(request);
    }

    return participant;
  }

  /**
   * Same shape as WithdrawalsService/WalletTransfersService's own
   * expireStaleRequests() - a bulk status update, not one row at a
   * time. Only PENDING requests past their own expiresAt are touched;
   * a COMPLETED or already-CANCELLED request is left alone regardless
   * of how old it is. Notifies the initiator afterward so they know
   * some participants never paid, rather than leaving them to
   * discover it by checking the ride's split-fare screen themselves.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async expireStaleRequests(): Promise<void> {
    const stale = await this.requestsRepo.find({
      where: { status: SplitFareStatus.PENDING },
    });
    const toExpire = stale.filter((r) => r.expiresAt && r.expiresAt < new Date());
    if (toExpire.length === 0) return;

    await this.requestsRepo
      .createQueryBuilder()
      .update(SplitFareRequest)
      .set({ status: SplitFareStatus.EXPIRED })
      .where('id IN (:...ids)', { ids: toExpire.map((r) => r.id) })
      .execute();

    this.logger.log(`Marked ${toExpire.length} stale split fare request(s) as expired.`);

    for (const request of toExpire) {
      this.events.emit('split_fare.expired', { initiatorId: request.initiatorId, rideId: request.rideId });
    }
  }
}
