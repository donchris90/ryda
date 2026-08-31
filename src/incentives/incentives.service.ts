import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OnEvent, EventEmitter2 } from '@nestjs/event-emitter';
import { Incentive, IncentiveType } from './entities/incentive.entity';
import { DriverIncentiveProgress, IncentiveProgressStatus } from './entities/driver-incentive-progress.entity';
import { CreateIncentiveDto } from './dto/incentives.dto';
import { DriversService } from '../drivers/drivers.service';
import { WalletsService } from '../wallets/wallets.service';
import { TransactionCategory } from '../common/enums/transaction.enum';

/**
 * Driven by the same `ride.completed` event webhooks/notifications listen
 * for — no new event needed, just another subscriber. Rewards always land
 * in the driver's personal wallet, even for fleet drivers: incentive bonuses
 * are individual-performance rewards, not ride-fare earnings, so they're
 * deliberately NOT routed through the fleet-earnings split that
 * RidesService.creditDriverEarnings() uses.
 */
@Injectable()
export class IncentivesService {
  private readonly logger = new Logger(IncentivesService.name);

  constructor(
    @InjectRepository(Incentive)
    private readonly incentivesRepo: Repository<Incentive>,
    @InjectRepository(DriverIncentiveProgress)
    private readonly progressRepo: Repository<DriverIncentiveProgress>,
    private readonly driversService: DriversService,
    private readonly walletsService: WalletsService,
    private readonly events: EventEmitter2,
  ) {}

  // ---- Admin management ----

  async create(dto: CreateIncentiveDto): Promise<Incentive> {
    return this.incentivesRepo.save(this.incentivesRepo.create({ ...dto, rewardAmount: dto.rewardAmount.toFixed(2) }));
  }

  async listActive(): Promise<Incentive[]> {
    return this.incentivesRepo.find({ where: { isActive: true }, order: { createdAt: 'DESC' } });
  }

  async listAll(): Promise<Incentive[]> {
    return this.incentivesRepo.find({ order: { createdAt: 'DESC' } });
  }

  async setActive(id: string, isActive: boolean): Promise<Incentive> {
    await this.incentivesRepo.update(id, { isActive });
    return this.incentivesRepo.findOne({ where: { id } }) as Promise<Incentive>;
  }

  async getDriverProgress(driverUserId: string): Promise<DriverIncentiveProgress[]> {
    const profile = await this.driversService.findByUserId(driverUserId);
    return this.progressRepo.find({ where: { driverId: profile.id }, order: { updatedAt: 'DESC' } });
  }

  /**
   * Admin-facing rollup for a single incentive: how many drivers are
   * participating, how far along they are, and how many have actually been
   * paid out. `driverId` on DriverIncentiveProgress is the driver PROFILE
   * id, not the user id — this module never needed to resolve that back to
   * a displayable name before, so this only returns raw ids/progress; the
   * admin UI resolves names itself via the existing driver list.
   */
  async getProgressForIncentive(incentiveId: string): Promise<{
    participantCount: number;
    completedCount: number;
    rewardedCount: number;
    items: DriverIncentiveProgress[];
  }> {
    const items = await this.progressRepo.find({
      where: { incentiveId },
      order: { updatedAt: 'DESC' },
    });
    return {
      participantCount: items.length,
      completedCount: items.filter((p) => p.status !== IncentiveProgressStatus.IN_PROGRESS).length,
      rewardedCount: items.filter((p) => p.status === IncentiveProgressStatus.REWARDED).length,
      items,
    };
  }

  // ---- Event-driven processing ----

  @OnEvent('ride.completed')
  async onRideCompleted(payload: { driverId: string }): Promise<void> {
    if (!payload.driverId) return;
    try {
      await this.processTripForIncentives(payload.driverId);
    } catch (err) {
      // Incentive processing should never take down ride completion.
      this.logger.warn(`Incentive processing failed for driver ${payload.driverId}: ${(err as Error).message}`);
    }
  }

  private async processTripForIncentives(driverUserId: string): Promise<void> {
    const driverProfile = await this.driversService.findByUserId(driverUserId);
    const activeIncentives = await this.incentivesRepo.find({ where: { isActive: true } });
    const now = new Date();

    for (const incentive of activeIncentives) {
      if (incentive.type === IncentiveType.PEAK_HOUR) {
        await this.processPeakHour(incentive, driverUserId, now);
      } else if (incentive.type === IncentiveType.MILESTONE) {
        await this.processMilestone(incentive, driverProfile.id, driverUserId, driverProfile.completedTrips);
      } else if (incentive.type === IncentiveType.STREAK) {
        await this.processStreak(incentive, driverProfile.id, driverUserId, now);
      } else if (incentive.type === IncentiveType.QUEST) {
        await this.processQuest(incentive, driverProfile.id, driverUserId);
      }
    }
  }

  private isWithinPeakWindow(hour: number, start: number, end: number): boolean {
    if (start <= end) return hour >= start && hour < end;
    return hour >= start || hour < end; // wraps past midnight
  }

  private async processPeakHour(incentive: Incentive, driverUserId: string, now: Date): Promise<void> {
    if (incentive.peakStartHour == null || incentive.peakEndHour == null) return;
    if (!this.isWithinPeakWindow(now.getHours(), incentive.peakStartHour, incentive.peakEndHour)) return;

    await this.reward(driverUserId, incentive, `Peak-hour bonus: ${incentive.name}`);
  }

  private async processMilestone(
    incentive: Incentive,
    driverProfileId: string,
    driverUserId: string,
    lifetimeTrips: number,
  ): Promise<void> {
    if (!incentive.targetTrips || lifetimeTrips < incentive.targetTrips) return;

    let progress = await this.progressRepo.findOne({ where: { incentiveId: incentive.id, driverId: driverProfileId } });
    if (progress?.status === IncentiveProgressStatus.REWARDED) return; // one-time only

    if (!progress) {
      progress = this.progressRepo.create({ incentiveId: incentive.id, driverId: driverProfileId, tripsCompleted: 0 });
    }
    progress.tripsCompleted = lifetimeTrips;
    progress.status = IncentiveProgressStatus.REWARDED;
    progress.completedAt = new Date();
    progress.rewardedAt = new Date();
    await this.progressRepo.save(progress);

    await this.reward(driverUserId, incentive, `Milestone reached: ${incentive.name}`);
  }

  private async processStreak(
    incentive: Incentive,
    driverProfileId: string,
    driverUserId: string,
    now: Date,
  ): Promise<void> {
    if (!incentive.targetTrips || !incentive.windowHours) return;

    let progress = await this.progressRepo.findOne({ where: { incentiveId: incentive.id, driverId: driverProfileId } });
    const windowMs = incentive.windowHours * 60 * 60 * 1000;

    const windowExpired =
      !progress?.windowStartedAt || now.getTime() - progress.windowStartedAt.getTime() > windowMs;

    if (!progress) {
      progress = this.progressRepo.create({ incentiveId: incentive.id, driverId: driverProfileId, tripsCompleted: 0 });
    }
    if (windowExpired) {
      progress.tripsCompleted = 0;
      progress.windowStartedAt = now;
      progress.status = IncentiveProgressStatus.IN_PROGRESS;
    }

    progress.tripsCompleted += 1;

    if (progress.tripsCompleted >= incentive.targetTrips) {
      progress.status = IncentiveProgressStatus.REWARDED;
      progress.completedAt = now;
      progress.rewardedAt = now;
      await this.progressRepo.save(progress);
      await this.reward(driverUserId, incentive, `Streak completed: ${incentive.name}`);
      return;
    }

    await this.progressRepo.save(progress);
  }

  private async processQuest(incentive: Incentive, driverProfileId: string, driverUserId: string): Promise<void> {
    if (!incentive.targetTrips) return;

    let progress = await this.progressRepo.findOne({ where: { incentiveId: incentive.id, driverId: driverProfileId } });
    if (progress?.status === IncentiveProgressStatus.REWARDED) return; // one-time only

    if (!progress) {
      progress = this.progressRepo.create({ incentiveId: incentive.id, driverId: driverProfileId, tripsCompleted: 0 });
    }
    progress.tripsCompleted += 1;

    if (progress.tripsCompleted >= incentive.targetTrips) {
      progress.status = IncentiveProgressStatus.REWARDED;
      progress.completedAt = new Date();
      progress.rewardedAt = new Date();
      await this.progressRepo.save(progress);
      await this.reward(driverUserId, incentive, `Quest completed: ${incentive.name}`);
      return;
    }

    await this.progressRepo.save(progress);
  }

  private async reward(driverUserId: string, incentive: Incentive, description: string): Promise<void> {
    const wallet = await this.walletsService.getByUserId(driverUserId);
    await this.walletsService.credit(
      wallet.id,
      parseFloat(incentive.rewardAmount),
      TransactionCategory.BONUS,
      incentive.id,
      description,
    );
    this.events.emit('incentive.rewarded', {
      driverUserId,
      incentiveName: incentive.name,
      amount: incentive.rewardAmount,
    });
  }
}
