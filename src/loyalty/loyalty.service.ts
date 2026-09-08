import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { LoyaltyAccount, LoyaltyTier, TIER_THRESHOLDS } from './entities/loyalty-account.entity';
import { LoyaltyTransaction } from './entities/loyalty-transaction.entity';
import { WalletsService } from '../wallets/wallets.service';
import { SystemSettingsService, SETTING_KEYS } from '../settings/settings.service';
import { TransactionCategory } from '../common/enums/transaction.enum';

@Injectable()
export class LoyaltyService {
  private readonly logger = new Logger(LoyaltyService.name);

  constructor(
    @InjectRepository(LoyaltyAccount)
    private readonly accountsRepo: Repository<LoyaltyAccount>,
    @InjectRepository(LoyaltyTransaction)
    private readonly transactionsRepo: Repository<LoyaltyTransaction>,
    private readonly walletsService: WalletsService,
    private readonly config: ConfigService,
    private readonly settingsService: SystemSettingsService,
  ) {}

  private getPointsPerNairaSpent(): Promise<number> {
    return this.settingsService.getNumber(
      SETTING_KEYS.LOYALTY_POINTS_PER_NAIRA_SPENT,
      this.config.get<number>('loyalty.pointsPerNairaSpent')!,
    );
  }

  private getNairaPerPointRedeemed(): Promise<number> {
    return this.settingsService.getNumber(
      SETTING_KEYS.LOYALTY_NAIRA_PER_POINT_REDEEMED,
      this.config.get<number>('loyalty.nairaPerPointRedeemed')!,
    );
  }

  private getMinRedemptionPoints(): Promise<number> {
    return this.settingsService.getNumber(
      SETTING_KEYS.LOYALTY_MIN_REDEMPTION_POINTS,
      this.config.get<number>('loyalty.minRedemptionPoints')!,
    );
  }

  /**
   * Genuinely racy in practice — a passenger's own `GET /loyalty/me` can
   * land at nearly the same moment as the `ride.completed` event handler
   * below creating their account for the first time (found via live
   * testing: two near-simultaneous calls both saw "no account yet" and
   * both tried to INSERT, one hit the unique constraint on `userId` and
   * 500'd). A plain check-then-insert isn't safe here — catch the
   * conflict and re-fetch instead of assuming we're the only writer.
   */
  private async getOrCreateAccount(userId: string): Promise<LoyaltyAccount> {
    const existing = await this.accountsRepo.findOne({ where: { userId } });
    if (existing) return existing;

    try {
      return await this.accountsRepo.save(this.accountsRepo.create({ userId }));
    } catch (err) {
      // Someone else's insert won the race between our SELECT and INSERT — fetch what they created.
      const account = await this.accountsRepo.findOne({ where: { userId } });
      if (account) return account;
      throw err;
    }
  }

  private tierFor(lifetimePoints: number): LoyaltyTier {
    // Highest threshold not exceeding lifetimePoints — PLATINUM checked
    // first since thresholds are ascending.
    const tiers = [LoyaltyTier.PLATINUM, LoyaltyTier.GOLD, LoyaltyTier.SILVER, LoyaltyTier.BRONZE];
    return tiers.find((t) => lifetimePoints >= TIER_THRESHOLDS[t])!;
  }

  async getAccount(userId: string): Promise<LoyaltyAccount> {
    return this.getOrCreateAccount(userId);
  }

  /**
   * Everything the passenger-facing loyalty screen needs beyond the bare
   * account row: how far to the next tier, and the actual earn/redeem
   * rates - all read from the same admin-adjustable settings the rest of
   * this service enforces (see getPointsPerNairaSpent() etc. above),
   * never hardcoded a second time on the client. tier/pointsToNextTier
   * are null once at the top tier - there's nothing further to reach.
   */
  async getAccountSummary(userId: string): Promise<{
    pointsBalance: number;
    lifetimePoints: number;
    tier: LoyaltyTier;
    nextTier: LoyaltyTier | null;
    pointsToNextTier: number | null;
    pointsPerNairaSpent: number;
    nairaPerPointRedeemed: number;
    minRedemptionPoints: number;
  }> {
    const account = await this.getOrCreateAccount(userId);
    const tierOrder = [LoyaltyTier.BRONZE, LoyaltyTier.SILVER, LoyaltyTier.GOLD, LoyaltyTier.PLATINUM];
    const currentIndex = tierOrder.indexOf(account.tier);
    const nextTier = currentIndex < tierOrder.length - 1 ? tierOrder[currentIndex + 1] : null;

    const [pointsPerNairaSpent, nairaPerPointRedeemed, minRedemptionPoints] = await Promise.all([
      this.getPointsPerNairaSpent(),
      this.getNairaPerPointRedeemed(),
      this.getMinRedemptionPoints(),
    ]);

    return {
      pointsBalance: account.pointsBalance,
      lifetimePoints: account.lifetimePoints,
      tier: account.tier,
      nextTier,
      pointsToNextTier: nextTier ? TIER_THRESHOLDS[nextTier] - account.lifetimePoints : null,
      pointsPerNairaSpent,
      nairaPerPointRedeemed,
      minRedemptionPoints,
    };
  }

  async getTransactions(userId: string): Promise<LoyaltyTransaction[]> {
    return this.transactionsRepo.find({ where: { userId }, order: { createdAt: 'DESC' }, take: 50 });
  }

  /**
   * Wrapped in try/catch by the caller pattern used everywhere else in
   * this codebase (see IncentivesService) — a bug here must never be able
   * to break ride completion itself.
   */
  @OnEvent('ride.completed')
  async onRideCompleted(payload: { passengerId: string; driverId: string; totalFare: string | number }): Promise<void> {
    try {
      const fare = typeof payload.totalFare === 'string' ? parseFloat(payload.totalFare) : payload.totalFare;
      const pointsEarned = Math.floor(fare * (await this.getPointsPerNairaSpent()));
      if (pointsEarned <= 0) return;

      const account = await this.getOrCreateAccount(payload.passengerId);
      account.pointsBalance += pointsEarned;
      account.lifetimePoints += pointsEarned;
      account.tier = this.tierFor(account.lifetimePoints);
      await this.accountsRepo.save(account);

      await this.transactionsRepo.save(
        this.transactionsRepo.create({
          userId: payload.passengerId,
          direction: 'earned',
          points: pointsEarned,
          reason: 'Ride completed',
        }),
      );
    } catch (err) {
      this.logger.warn(`Loyalty points award failed (ride completion unaffected): ${(err as Error).message}`);
    }
  }

  async redeem(userId: string, points: number): Promise<{ pointsRedeemed: number; nairaCredited: number }> {
    const minRedemptionPoints = await this.getMinRedemptionPoints();
    if (points < minRedemptionPoints) {
      throw new BadRequestException(`Minimum redemption is ${minRedemptionPoints} points`);
    }
    const account = await this.getOrCreateAccount(userId);
    if (account.pointsBalance < points) {
      throw new BadRequestException('Not enough points');
    }

    const nairaCredited = Math.round(points * (await this.getNairaPerPointRedeemed()) * 100) / 100;

    account.pointsBalance -= points;
    await this.accountsRepo.save(account);

    await this.transactionsRepo.save(
      this.transactionsRepo.create({ userId, direction: 'redeemed', points, reason: 'Redeemed to wallet' }),
    );

    const wallet = await this.walletsService.getByUserId(userId);
    await this.walletsService.credit(wallet.id, nairaCredited, TransactionCategory.BONUS, account.id, 'Loyalty points redemption');

    return { pointsRedeemed: points, nairaCredited };
  }
}
