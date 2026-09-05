import { RidesService } from './rides.service';
import { RideCategory } from '../common/enums/ride.enum';

function buildService(overrides: Record<string, any> = {}) {
  const deps = {
    ridesRepo: {},
    fareService: {
      estimate: jest.fn().mockResolvedValue({
        baseFare: 500,
        distanceFare: 1000,
        timeFare: 300,
        surgeMultiplier: 1,
        nightMultiplierApplied: 1,
        airportFee: 0,
        tollFare: 0,
        discount: 0,
        totalFare: 1800,
        estimatedDistanceKm: 10,
        estimatedDurationMin: 20,
        currency: 'NGN',
        usedRealRouting: true,
      }),
      ...overrides.fareService,
    },
    driversService: {},
    vehiclesService: {},
    walletsService: {},
    commissionService: {},
    usersService: {},
    paymentsService: {},
    corporateService: {},
    passengersService: {},
    promotionsService: {},
    fleetService: {},
    dispatchService: {},
    autoDispatchService: {},
    pricingService: { calculateSurge: jest.fn().mockResolvedValue({ multiplier: 1 }) },
    events: { emit: jest.fn() },
    config: { get: jest.fn().mockReturnValue(0.25) },
    scheduledRidesQueue: {},
    reconciliationService: {},
    settingsService: {},
    metricsService: {},
    googleMaps: {},
    candidateSearchService: {},
    driverRankingService: {},
    geofenceService: {},
    airportService: {},
    poolMatchingService: {},
    featureFlagsService: {},
    ...overrides,
  };

  const service = new RidesService(
    deps.ridesRepo as any,
    deps.fareService as any,
    deps.driversService as any,
    deps.vehiclesService as any,
    deps.walletsService as any,
    deps.commissionService as any,
    deps.usersService as any,
    deps.paymentsService as any,
    deps.corporateService as any,
    deps.passengersService as any,
    deps.promotionsService as any,
    deps.fleetService as any,
    deps.dispatchService as any,
    deps.autoDispatchService as any,
    deps.pricingService as any,
    deps.events as any,
    deps.config as any,
    deps.scheduledRidesQueue as any,
    deps.reconciliationService as any,
    deps.settingsService as any,
    deps.metricsService as any,
    deps.googleMaps as any,
    deps.candidateSearchService as any,
    deps.driverRankingService as any,
    deps.geofenceService as any,
    deps.airportService as any,
    {} as any, // fraudService (not exercised by this suite)
    deps.poolMatchingService as any,
    deps.featureFlagsService as any,
  );

  return { service, deps };
}

const baseDto = {
  category: RideCategory.ECONOMY,
  pickupLat: 6.6018,
  pickupLng: 3.3515,
  dropoffLat: 6.4281,
  dropoffLng: 3.4219,
};

describe('RidesService.estimateFare() - pool-discount preview', () => {
  it('returns the plain fare breakdown unchanged when isPooled is not requested', async () => {
    const { service } = buildService();

    const result = await service.estimateFare(baseDto as any);

    expect(result.totalFare).toBe(1800);
    expect(result).not.toHaveProperty('estimatedPoolDiscount');
    expect(result).not.toHaveProperty('estimatedPooledTotalFare');
  });

  it('keeps totalFare as the honest unmatched price even when isPooled is requested - a match is never guaranteed', async () => {
    const { service } = buildService();

    const result = await service.estimateFare({ ...baseDto, isPooled: true } as any);

    expect(result.totalFare).toBe(1800);
  });

  it('shows the potential discount and pooled total as separate fields, computed from the same config the real match-time discount uses', async () => {
    const { service, deps } = buildService();

    const result: any = await service.estimateFare({ ...baseDto, isPooled: true } as any);

    expect(deps.config.get).toHaveBeenCalledWith('pooling.discountFraction');
    expect(result.estimatedPoolDiscount).toBe(450); // 1800 * 0.25
    expect(result.estimatedPooledTotalFare).toBe(1350); // 1800 - 450
  });

  it('falls back to no discount rather than throwing if the config value is somehow missing', async () => {
    const { service } = buildService({ config: { get: jest.fn().mockReturnValue(undefined) } });

    const result: any = await service.estimateFare({ ...baseDto, isPooled: true } as any);

    expect(result.estimatedPoolDiscount).toBe(0);
    expect(result.estimatedPooledTotalFare).toBe(1800);
  });
});
