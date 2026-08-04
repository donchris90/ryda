import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SplitFareRequest, SplitFareStatus } from './entities/split-fare-request.entity';
import { SplitFareParticipant, SplitParticipantStatus } from './entities/split-fare-participant.entity';
import { Ride } from '../rides/entities/ride.entity';
import { UsersService } from '../users/users.service';
import { WalletsService } from '../wallets/wallets.service';
import { TransactionCategory } from '../common/enums/transaction.enum';

interface CreateSplitInput {
  participantPhones: string[];
  /** Explicit per-participant amounts; if omitted, the ride's total is split evenly among initiator + participants. */
  amounts?: number[];
}

@Injectable()
export class SplitFareService {
  constructor(
    @InjectRepository(SplitFareRequest)
    private readonly requestsRepo: Repository<SplitFareRequest>,
    @InjectRepository(SplitFareParticipant)
    private readonly participantsRepo: Repository<SplitFareParticipant>,
    @InjectRepository(Ride)
    private readonly ridesRepo: Repository<Ride>,
    private readonly usersService: UsersService,
    private readonly walletsService: WalletsService,
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

    const request = await this.requestsRepo.save(
      this.requestsRepo.create({ rideId, initiatorId, totalAmount: totalFare.toFixed(2) }),
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
}
