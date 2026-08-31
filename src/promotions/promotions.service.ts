import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Promotion, PromotionType } from './entities/promotion.entity';
import { PromotionRedemption } from './entities/promotion-redemption.entity';
import { Campaign } from './entities/campaign.entity';
import { ReferralGrant } from './entities/referral-grant.entity';
import { CreateCampaignDto, CreatePromotionDto } from './dto/promotions.dto';
import { UsersService } from '../users/users.service';
import { WalletsService } from '../wallets/wallets.service';
import { TransactionCategory } from '../common/enums/transaction.enum';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { FraudService } from '../fraud/fraud.service';
import { SystemSettingsService, SETTING_KEYS } from '../settings/settings.service';

export interface PromoPreview {
  promotion: Promotion;
  discountAmount: number;
  appliesUpfront: boolean; // false for cashback — settled after ride completion
}

@Injectable()
export class PromotionsService {
  constructor(
    @InjectRepository(Promotion)
    private readonly promotionsRepo: Repository<Promotion>,
    @InjectRepository(PromotionRedemption)
    private readonly redemptionsRepo: Repository<PromotionRedemption>,
    @InjectRepository(Campaign)
    private readonly campaignsRepo: Repository<Campaign>,
    @InjectRepository(ReferralGrant)
    private readonly referralGrantsRepo: Repository<ReferralGrant>,
    private readonly usersService: UsersService,
    private readonly walletsService: WalletsService,
    private readonly config: ConfigService,
    private readonly events: EventEmitter2,
    private readonly fraudService: FraudService,
    private readonly settingsService: SystemSettingsService,
  ) {}

  // ---- Coupons / promo codes ----

  async createPromotion(dto: CreatePromotionDto): Promise<Promotion> {
    const existing = await this.promotionsRepo.findOne({ where: { code: dto.code } });
    if (existing) throw new BadRequestException('A promotion with this code already exists');

    const promotion = this.promotionsRepo.create({
      ...dto,
      value: dto.value.toFixed(2),
      maxDiscountAmount: dto.maxDiscountAmount?.toFixed(2) ?? null,
      minFareAmount: dto.minFareAmount?.toFixed(2) ?? null,
      validFrom: dto.validFrom ? new Date(dto.validFrom) : null,
      validUntil: dto.validUntil ? new Date(dto.validUntil) : null,
    });
    return this.promotionsRepo.save(promotion);
  }

  async listPromotions(): Promise<Promotion[]> {
    return this.promotionsRepo.find({ order: { createdAt: 'DESC' } });
  }

  async setActive(id: string, isActive: boolean): Promise<Promotion> {
    const promotion = await this.promotionsRepo.findOne({ where: { id } });
    if (!promotion) throw new NotFoundException('Promotion not found');
    promotion.isActive = isActive;
    return this.promotionsRepo.save(promotion);
  }

  /**
   * Deliberately excludes `code` and `type` — changing either out from
   * under an already-shared/printed promo code would silently change what
   * a code someone has already been given actually does. Deactivate and
   * create a new code instead for that case.
   */
  async updatePromotion(id: string, dto: Partial<CreatePromotionDto>): Promise<Promotion> {
    const promotion = await this.promotionsRepo.findOne({ where: { id } });
    if (!promotion) throw new NotFoundException('Promotion not found');

    if (dto.description !== undefined) promotion.description = dto.description;
    if (dto.value !== undefined) promotion.value = dto.value.toFixed(2);
    if (dto.maxDiscountAmount !== undefined) promotion.maxDiscountAmount = dto.maxDiscountAmount.toFixed(2);
    if (dto.minFareAmount !== undefined) promotion.minFareAmount = dto.minFareAmount.toFixed(2);
    if (dto.usageLimitTotal !== undefined) promotion.usageLimitTotal = dto.usageLimitTotal;
    if (dto.usageLimitPerUser !== undefined) promotion.usageLimitPerUser = dto.usageLimitPerUser;
    if (dto.validFrom !== undefined) promotion.validFrom = dto.validFrom ? new Date(dto.validFrom) : null;
    if (dto.validUntil !== undefined) promotion.validUntil = dto.validUntil ? new Date(dto.validUntil) : null;

    return this.promotionsRepo.save(promotion);
  }

  /** Usage/performance figures for the admin promotions list — redemption count and total discount given, derived straight from the redemption ledger rather than trusting `timesRedeemed` alone. */
  async getStats(id: string): Promise<{ redemptionCount: number; totalDiscountGiven: string }> {
    const redemptions = await this.redemptionsRepo.find({ where: { promotionId: id } });
    const totalDiscountGiven = redemptions.reduce((sum, r) => sum + parseFloat(r.discountAmount), 0);
    return { redemptionCount: redemptions.length, totalDiscountGiven: totalDiscountGiven.toFixed(2) };
  }

  /** Validates a code for a user/fare without redeeming it — safe to call for a UI preview. */
  async validate(code: string, userId: string, fareAmount: number): Promise<PromoPreview> {
    const promotion = await this.promotionsRepo.findOne({ where: { code: code.toUpperCase() } });
    if (!promotion) throw new NotFoundException('Invalid promo code');
    if (!promotion.isActive) throw new BadRequestException('This promo code is no longer active');

    const now = new Date();
    if (promotion.validFrom && now < promotion.validFrom) {
      throw new BadRequestException('This promo code is not active yet');
    }
    if (promotion.validUntil && now > promotion.validUntil) {
      throw new BadRequestException('This promo code has expired');
    }
    if (promotion.minFareAmount && fareAmount < parseFloat(promotion.minFareAmount)) {
      throw new BadRequestException(
        `This promo requires a minimum fare of ${promotion.minFareAmount}`,
      );
    }
    if (promotion.usageLimitTotal && promotion.timesRedeemed >= promotion.usageLimitTotal) {
      throw new BadRequestException('This promo code has reached its usage limit');
    }

    const userRedemptions = await this.redemptionsRepo.count({
      where: { promotionId: promotion.id, userId },
    });
    if (userRedemptions >= promotion.usageLimitPerUser) {
      throw new BadRequestException('You have already used this promo code');
    }

    const discountAmount = this.computeDiscount(promotion, fareAmount);
    return {
      promotion,
      discountAmount,
      appliesUpfront: promotion.type !== PromotionType.CASHBACK,
    };
  }

  /** Validates then records the redemption — call this once the ride is actually created. */
  async redeem(
    code: string,
    userId: string,
    rideId: string,
    fareAmount: number,
  ): Promise<PromoPreview> {
    const preview = await this.validate(code, userId, fareAmount);

    await this.redemptionsRepo.save(
      this.redemptionsRepo.create({
        promotionId: preview.promotion.id,
        userId,
        rideId,
        discountAmount: preview.discountAmount.toFixed(2),
      }),
    );
    await this.promotionsRepo.increment({ id: preview.promotion.id }, 'timesRedeemed', 1);

    this.events.emit('promotion.redeemed', {
      userId,
      code,
      rideId,
      discountAmount: preview.discountAmount,
    });

    return preview;
  }

  /** Called after a ride completes — pays out cashback for any cashback-type redemption on it. */
  async settleCashbackForRide(rideId: string, passengerUserId: string): Promise<void> {
    const redemption = await this.redemptionsRepo.findOne({ where: { rideId } });
    if (!redemption) return;

    const promotion = await this.promotionsRepo.findOne({ where: { id: redemption.promotionId } });
    if (!promotion || promotion.type !== PromotionType.CASHBACK) return;

    const wallet = await this.walletsService.getByUserId(passengerUserId);
    await this.walletsService.credit(
      wallet.id,
      parseFloat(redemption.discountAmount),
      TransactionCategory.CASHBACK,
      rideId,
      `Cashback from promo ${promotion.code}`,
    );
  }

  private computeDiscount(promotion: Promotion, fareAmount: number): number {
    let discount: number;
    if (promotion.type === PromotionType.FIXED_AMOUNT) {
      discount = parseFloat(promotion.value);
    } else {
      // PERCENTAGE or CASHBACK — both are a % of the fare.
      discount = fareAmount * (parseFloat(promotion.value) / 100);
    }
    if (promotion.maxDiscountAmount) {
      discount = Math.min(discount, parseFloat(promotion.maxDiscountAmount));
    }
    return Math.min(Math.round(discount * 100) / 100, fareAmount);
  }

  // ---- Campaigns ----

  async createCampaign(dto: CreateCampaignDto): Promise<Campaign> {
    const campaign = this.campaignsRepo.create({
      ...dto,
      startDate: dto.startDate ? new Date(dto.startDate) : null,
      endDate: dto.endDate ? new Date(dto.endDate) : null,
    });
    return this.campaignsRepo.save(campaign);
  }

  async listCampaigns(): Promise<Campaign[]> {
    return this.campaignsRepo.find({ order: { createdAt: 'DESC' } });
  }

  async setCampaignActive(id: string, isActive: boolean): Promise<Campaign> {
    const campaign = await this.campaignsRepo.findOne({ where: { id } });
    if (!campaign) throw new NotFoundException('Campaign not found');
    campaign.isActive = isActive;
    return this.campaignsRepo.save(campaign);
  }

  // ---- Referral bonuses ----

  /**
   * Grants a one-time referral bonus to both the new user and whoever
   * referred them, on the referee's FIRST completed ride (not at signup —
   * this avoids paying out for accounts that never actually ride).
   * The unique constraint on ReferralGrant.refereeUserId makes this safe to
   * call on every completed ride without double-granting.
   */
  async grantReferralBonusIfEligible(refereeUserId: string): Promise<void> {
    const referee = await this.usersService.findById(refereeUserId);
    if (!referee.referredByCode) return;

    const alreadyGranted = await this.referralGrantsRepo.findOne({
      where: { refereeUserId },
    });
    if (alreadyGranted) return;

    const referrer = await this.usersService.findByReferralCode(referee.referredByCode);
    if (!referrer) return;

    // Flag for review but still grant the bonus — a shared device is a
    // signal worth a human look (family members sharing a phone is a
    // plausible false positive), not an automatic block.
    await this.fraudService.checkReferralAbuse(referrer.id, refereeUserId);

    const refereeBonus = await this.settingsService.getNumber(
      SETTING_KEYS.REFEREE_BONUS,
      this.config.get<number>('referral.refereeBonus')!,
    );
    const referrerBonus = await this.settingsService.getNumber(
      SETTING_KEYS.REFERRER_BONUS,
      this.config.get<number>('referral.referrerBonus')!,
    );

    try {
      await this.referralGrantsRepo.save(
        this.referralGrantsRepo.create({
          referrerUserId: referrer.id,
          refereeUserId,
          referrerBonus: referrerBonus.toFixed(2),
          refereeBonus: refereeBonus.toFixed(2),
        }),
      );
    } catch {
      // Unique constraint hit — another concurrent request already granted it.
      return;
    }

    const refereeWallet = await this.walletsService.getByUserId(refereeUserId);
    await this.walletsService.credit(
      refereeWallet.id,
      refereeBonus,
      TransactionCategory.REFERRAL,
      undefined,
      'Referral sign-up bonus',
    );

    const referrerWallet = await this.walletsService.getByUserId(referrer.id);
    await this.walletsService.credit(
      referrerWallet.id,
      referrerBonus,
      TransactionCategory.REFERRAL,
      undefined,
      `Referral bonus for inviting ${referee.firstName}`,
    );

    this.events.emit('referral.bonus_granted', { userId: refereeUserId, amount: refereeBonus.toFixed(2) });
    this.events.emit('referral.bonus_granted', { userId: referrer.id, amount: referrerBonus.toFixed(2) });
  }

  /**
   * There was no self-service way for a user to see their own referral
   * earnings or invite history at all — only the automated grant logic
   * above existed. Found missing while building the driver app's
   * Referral Centre. User.referralCode itself is already returned by
   * GET /users/me, so this only needs to cover what wasn't already
   * available: total earned, and who's actually signed up with the code.
   */
  async getReferralSummary(userId: string) {
    const grants = await this.referralGrantsRepo.find({
      where: { referrerUserId: userId },
      order: { createdAt: 'DESC' },
    });

    const totalEarned = grants.reduce((sum, g) => sum + parseFloat(g.referrerBonus), 0);

    const refereeIds = grants.map((g) => g.refereeUserId);
    const referees = refereeIds.length ? await this.usersService.findByIds(refereeIds) : [];
    const refereeById = new Map(referees.map((u) => [u.id, u]));

    return {
      totalEarned: totalEarned.toFixed(2),
      totalReferrals: grants.length,
      invites: grants.map((g) => {
        const referee = refereeById.get(g.refereeUserId);
        return {
          name: referee ? `${referee.firstName} ${referee.lastName}` : 'Unknown',
          bonusEarned: g.referrerBonus,
          joinedAt: g.createdAt,
        };
      }),
    };
  }
}
