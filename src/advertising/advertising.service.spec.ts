import { NotFoundException } from '@nestjs/common';
import { AdvertisingService } from './advertising.service';

function build(overrides: Record<string, any> = {}) {
  const campaignsRepo = {
    findOne: jest.fn().mockResolvedValue({ id: 'campaign-1', name: 'Launch Week' }),
    save: jest.fn(async (d: any) => d),
    create: jest.fn((d: any) => d),
    ...overrides.campaignsRepo,
  };
  const bannersRepo = {
    findOne: jest.fn(),
    save: jest.fn(async (d: any) => d),
    find: jest.fn().mockResolvedValue([]),
    ...overrides.bannersRepo,
  };
  const locationsRepo = {
    findOne: jest.fn(),
    save: jest.fn(async (d: any) => d),
    find: jest.fn().mockResolvedValue([]),
    ...overrides.locationsRepo,
  };

  const service = new AdvertisingService(campaignsRepo as any, bannersRepo as any, locationsRepo as any);
  return { service, campaignsRepo, bannersRepo, locationsRepo };
}

describe('AdvertisingService.setSponsoredLocationActive()', () => {
  it('activates a sponsored location', async () => {
    const { service } = build({
      locationsRepo: { findOne: jest.fn().mockResolvedValue({ id: 'loc-1', isActive: false }) },
    });
    const result = await service.setSponsoredLocationActive('loc-1', true);
    expect(result.isActive).toBe(true);
  });

  it('deactivates a sponsored location - previously there was no way to do this at all', async () => {
    const { service } = build({
      locationsRepo: { findOne: jest.fn().mockResolvedValue({ id: 'loc-1', isActive: true }) },
    });
    const result = await service.setSponsoredLocationActive('loc-1', false);
    expect(result.isActive).toBe(false);
  });

  it('throws NotFoundException for a location that does not exist', async () => {
    const { service } = build({ locationsRepo: { findOne: jest.fn().mockResolvedValue(null) } });
    await expect(service.setSponsoredLocationActive('missing', true)).rejects.toThrow(NotFoundException);
  });
});

describe('AdvertisingService.getCampaignAnalytics()', () => {
  it('rolls up impressions/clicks from every banner and location tagged with this campaign', async () => {
    const { service } = build({
      bannersRepo: {
        find: jest.fn().mockResolvedValue([
          { impressions: 1000, clicks: 50 },
          { impressions: 500, clicks: 10 },
        ]),
      },
      locationsRepo: {
        find: jest.fn().mockResolvedValue([{ impressions: 200 }, { impressions: 300 }]),
      },
    });

    const result = await service.getCampaignAnalytics('campaign-1');

    expect(result.banners).toEqual({ total: 2, impressions: 1500, clicks: 60, ctr: 60 / 1500 });
    expect(result.sponsoredLocations).toEqual({ total: 2, impressions: 500 });
  });

  it('returns a CTR of 0 (not NaN or Infinity) for a campaign with zero impressions so far', async () => {
    const { service } = build();
    const result = await service.getCampaignAnalytics('campaign-1');
    expect(result.banners.ctr).toBe(0);
    expect(Number.isFinite(result.banners.ctr)).toBe(true);
  });

  it('throws NotFoundException for a campaign that does not exist', async () => {
    const { service } = build({ campaignsRepo: { findOne: jest.fn().mockResolvedValue(null) } });
    await expect(service.getCampaignAnalytics('missing')).rejects.toThrow(NotFoundException);
  });
});
