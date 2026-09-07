import { NotFoundException } from '@nestjs/common';
import { PromotionsService } from './promotions.service';
import { PromotionType } from './entities/promotion.entity';

function fakePromotion(overrides: Record<string, any> = {}) {
  return {
    id: 'promo-1',
    code: 'SAVE10',
    isActive: true,
    type: PromotionType.PERCENTAGE,
    value: '10.00',
    usageLimitPerUser: 5,
    usageLimitTotal: null,
    minFareAmount: null,
    maxDiscountAmount: null,
    validFrom: null,
    validUntil: null,
    description: null,
    timesRedeemed: 0,
    ...overrides,
  };
}

function build(overrides: Record<string, any> = {}) {
  const promotionsRepo = {
    findOne: jest.fn().mockResolvedValue(fakePromotion()),
    save: jest.fn(async (d: any) => d),
    ...overrides.promotionsRepo,
  };
  const redemptionsRepo = {
    find: jest.fn().mockResolvedValue([]),
    ...overrides.redemptionsRepo,
  };
  const campaignsRepo = {
    findOne: jest.fn(),
    save: jest.fn(async (d: any) => d),
    ...overrides.campaignsRepo,
  };
  const referralGrantsRepo = {};
  const usersService = {};
  const walletsService = {};
  const config = { get: jest.fn() };
  const events = { emit: jest.fn() };
  const fraudService = {};
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

  return { service, promotionsRepo, redemptionsRepo, campaignsRepo };
}

describe('PromotionsService.updatePromotion()', () => {
  it('updates only the fields provided, leaving the rest untouched', async () => {
    const { service, promotionsRepo } = build();

    const result = await service.updatePromotion('promo-1', { description: 'Updated desc', value: 15 });

    expect(result.description).toBe('Updated desc');
    expect(result.value).toBe('15.00');
    expect(result.usageLimitPerUser).toBe(5); // untouched
  });

  it('does not accept code/type/campaignId - not part of UpdatePromotionDto at all', async () => {
    const { service } = build();
    const result = await service.updatePromotion('promo-1', {} as any);
    expect(result.code).toBe('SAVE10'); // never touched, regardless of what's in the body
  });

  it('throws NotFoundException for a promotion that does not exist', async () => {
    const { service, promotionsRepo } = build({ promotionsRepo: { findOne: jest.fn().mockResolvedValue(null) } });
    await expect(service.updatePromotion('missing', { description: 'x' })).rejects.toThrow(NotFoundException);
  });
});

describe('PromotionsService.getPromotionStats()', () => {
  it('computes redemptionCount and totalDiscountGiven from the actual redemption log, not timesRedeemed', async () => {
    const { service, redemptionsRepo } = build({
      redemptionsRepo: {
        find: jest.fn().mockResolvedValue([
          { discountAmount: '100.00' },
          { discountAmount: '250.50' },
          { discountAmount: '75.25' },
        ]),
      },
    });

    const stats = await service.getPromotionStats('promo-1');

    expect(stats.redemptionCount).toBe(3);
    expect(stats.totalDiscountGiven).toBe('425.75');
  });

  it('returns zeroes for a promotion with no redemptions yet', async () => {
    const { service } = build();
    const stats = await service.getPromotionStats('promo-1');
    expect(stats).toEqual({ redemptionCount: 0, totalDiscountGiven: '0.00' });
  });

  it('throws NotFoundException for a promotion that does not exist', async () => {
    const { service } = build({ promotionsRepo: { findOne: jest.fn().mockResolvedValue(null) } });
    await expect(service.getPromotionStats('missing')).rejects.toThrow(NotFoundException);
  });
});

describe('PromotionsService.setCampaignActive()', () => {
  it('activates a campaign', async () => {
    const { service, campaignsRepo } = build({
      campaignsRepo: { findOne: jest.fn().mockResolvedValue({ id: 'campaign-1', isActive: false }) },
    });
    const result = await service.setCampaignActive('campaign-1', true);
    expect(result.isActive).toBe(true);
  });

  it('deactivates a campaign', async () => {
    const { service } = build({
      campaignsRepo: { findOne: jest.fn().mockResolvedValue({ id: 'campaign-1', isActive: true }) },
    });
    const result = await service.setCampaignActive('campaign-1', false);
    expect(result.isActive).toBe(false);
  });

  it('throws NotFoundException for a campaign that does not exist', async () => {
    const { service } = build({ campaignsRepo: { findOne: jest.fn().mockResolvedValue(null) } });
    await expect(service.setCampaignActive('missing', true)).rejects.toThrow(NotFoundException);
  });
});
