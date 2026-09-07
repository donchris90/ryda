import { LogisticsService, DeliveryFareBreakdown } from './logistics.service';
import { DeliveryCategory, DeliverySpeedTier } from './entities/delivery-order.entity';

function buildService(overrides: Record<string, any> = {}) {
  const deps = {
    ordersRepo: { create: jest.fn((d) => d), save: jest.fn(async (d) => ({ id: 'order-1', ...d })), findOne: jest.fn(), find: jest.fn().mockResolvedValue([]), manager: { transaction: jest.fn() } },
    config: {
      get: jest.fn((key: string) => {
        const values: Record<string, unknown> = {
          'pricing.currency': 'NGN',
          'logistics.standardDiscount': 0.85,
          'logistics.baseFare': 300,
          'logistics.perKm': 100,
          'logistics.perKg': 50,
          'logistics.minimumFare': 500,
        };
        return values[key];
      }),
    },
    driversService: {},
    vehiclesService: {},
    walletsService: {},
    commissionService: {},
    corporateService: {},
    fleetService: {},
    usersService: {},
    paymentsService: {},
    reconciliationService: {},
    settingsService: {
      getNumber: jest.fn(async (_key: string, fallback: number) => fallback),
      ...overrides.settingsService,
    },
    vehicleTypesService: { getByType: jest.fn() },
    candidateSearchService: {},
    driverRankingService: {},
    events: { emit: jest.fn() },
    metrics: {},
    geofenceService: {},
  };

  const service = new LogisticsService(
    deps.ordersRepo as any,
    deps.config as any,
    deps.driversService as any,
    deps.vehiclesService as any,
    deps.walletsService as any,
    deps.commissionService as any,
    deps.corporateService as any,
    deps.fleetService as any,
    deps.usersService as any,
    deps.paymentsService as any,
    deps.reconciliationService as any,
    deps.settingsService as any,
    deps.vehicleTypesService as any,
    deps.candidateSearchService as any,
    deps.driverRankingService as any,
    deps.events as any,
    deps.metrics as any,
    deps.geofenceService as any,
  );

  return { service, deps };
}

const baseDto = {
  category: DeliveryCategory.PARCEL,
  pickupLat: 6.5244,
  pickupLng: 3.3792,
  dropoffLat: 6.6,
  dropoffLng: 3.45,
};

describe('LogisticsService.estimateFare() - speed tier pricing', () => {
  it('defaults to EXPRESS (unchanged fare) when no speedTier is given at all - backward compatible for any existing caller', async () => {
    const { service } = buildService();
    const result: DeliveryFareBreakdown = await service.estimateFare(baseDto as any);
    expect(result.speedTier).toBe(DeliverySpeedTier.EXPRESS);
  });

  it('EXPRESS is exactly the base computed fare - the unchanged baseline, not a surcharge', async () => {
    const { service } = buildService();
    const expressResult = await service.estimateFare({ ...baseDto, speedTier: DeliverySpeedTier.EXPRESS } as any);
    const defaultResult = await service.estimateFare(baseDto as any);
    expect(expressResult.totalFare).toBe(defaultResult.totalFare);
  });

  it('STANDARD applies the configured discount to the total fare', async () => {
    const { service } = buildService();
    const expressResult = await service.estimateFare({ ...baseDto, speedTier: DeliverySpeedTier.EXPRESS } as any);
    const standardResult = await service.estimateFare({ ...baseDto, speedTier: DeliverySpeedTier.STANDARD } as any);

    expect(standardResult.speedTier).toBe(DeliverySpeedTier.STANDARD);
    expect(standardResult.totalFare).toBeCloseTo(expressResult.totalFare * 0.85, 2);
    expect(standardResult.totalFare).toBeLessThan(expressResult.totalFare);
  });

  it('reads the discount from admin-configurable settings, not just the hardcoded config default', async () => {
    const { service, deps } = buildService({
      settingsService: { getNumber: jest.fn().mockResolvedValue(0.5) }, // admin set a steeper 50% discount
    });

    const result = await service.estimateFare({ ...baseDto, speedTier: DeliverySpeedTier.STANDARD } as any);
    const expressResult = await service.estimateFare({ ...baseDto, speedTier: DeliverySpeedTier.EXPRESS } as any);

    expect(deps.settingsService.getNumber).toHaveBeenCalledWith('logistics.standardDiscount', 0.85);
    expect(result.totalFare).toBeCloseTo(expressResult.totalFare * 0.5, 2);
  });

  it('never looks up the discount setting at all for an EXPRESS estimate - no unnecessary settings-table read on the common path', async () => {
    const { service, deps } = buildService();
    await service.estimateFare({ ...baseDto, speedTier: DeliverySpeedTier.EXPRESS } as any);
    expect(deps.settingsService.getNumber).not.toHaveBeenCalledWith('logistics.standardDiscount', expect.anything());
  });
});
