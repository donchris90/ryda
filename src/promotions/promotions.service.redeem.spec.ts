import { PromotionsService } from './promotions.service';
import { PromotionType } from './entities/promotion.entity';

function fakePromotion(overrides: Record<string, any> = {}) {
  return {
    id: 'promo-1',
    code: 'SAVE10',
    isActive: true,
    type: PromotionType.PERCENTAGE,
    value: '10',
    usageLimitPerUser: 5,
    usageLimitTotal: null,
    minFareAmount: null,
    maxDiscountAmount: null,
    validFrom: null,
    validUntil: null,
    timesRedeemed: 0,
    ...overrides,
  };
}

function build(overrides: Record<string, any> = {}) {
  const promotionsRepo = {
    findOne: jest.fn().mockResolvedValue(fakePromotion()),
    increment: jest.fn().mockResolvedValue(undefined),
    ...overrides.promotionsRepo,
  };
  const redemptionsRepo = {
    count: jest.fn().mockResolvedValue(0),
    create: jest.fn((d: any) => d),
    save: jest.fn(async (d: any) => ({ id: 'redemption-1', ...d })),
    ...overrides.redemptionsRepo,
  };
  const campaignsRepo = {};
  const referralGrantsRepo = {};
  const usersService = {};
  const walletsService = {};
  const config = { get: jest.fn() };
  const events = { emit: jest.fn() };
  const fraudService = {
    checkPromoRedemptionPattern: jest.fn().mockResolvedValue(undefined),
    checkReferralAbuse: jest.fn().mockResolvedValue(undefined),
    ...overrides.fraudService,
  };
  const settingsService = { getNumber: jest.fn() };

  const service = new PromotionsService(
    promotionsRepo as any,
    redemptionsRepo as any,
    campaignsRepo as any,
    referralGrantsRepo as any,
    usersService as any,
    walletsService as any,
    config as any,
    events as any,
    fraudService as any,
    settingsService as any,
  );

  return { service, promotionsRepo, redemptionsRepo, fraudService };
}

describe('PromotionsService.redeem() - promo-redemption pattern detection', () => {
  it('checks the pattern (with the recent-redemption count) after a redemption is recorded', async () => {
    const { service, fraudService } = build({
      redemptionsRepo: {
        count: jest.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(5), // usage-limit check, then recent-window check
        create: jest.fn((d: any) => d),
        save: jest.fn(async (d: any) => ({ id: 'redemption-1', ...d })),
      },
    });

    await service.redeem('SAVE10', 'user-1', 'ride-1', 1000);

    expect(fraudService.checkPromoRedemptionPattern).toHaveBeenCalledWith('user-1', 5);
  });

  it('never checks the pattern (or redeems anything) when the promo code itself is invalid', async () => {
    const { service, fraudService } = build({
      promotionsRepo: { findOne: jest.fn().mockResolvedValue(null) },
    });

    await expect(service.redeem('BADCODE', 'user-1', 'ride-1', 1000)).rejects.toThrow();
    expect(fraudService.checkPromoRedemptionPattern).not.toHaveBeenCalled();
  });

  it('never checks the pattern when the user has already exhausted their per-user redemption limit', async () => {
    const { service, fraudService, redemptionsRepo } = build();
    redemptionsRepo.count.mockResolvedValue(5); // equals usageLimitPerUser

    await expect(service.redeem('SAVE10', 'user-1', 'ride-1', 1000)).rejects.toThrow();
    expect(fraudService.checkPromoRedemptionPattern).not.toHaveBeenCalled();
  });

  it('a fraud-check failure never breaks the redemption response the caller is waiting on', async () => {
    const { service } = build({
      fraudService: { checkPromoRedemptionPattern: jest.fn().mockRejectedValue(new Error('fraud service down')) },
    });

    await expect(service.redeem('SAVE10', 'user-1', 'ride-1', 1000)).resolves.toBeDefined();
  });
});
