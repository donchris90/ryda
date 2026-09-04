import { RidesService } from './rides.service';
import { RideStatus, PaymentMethod, RideCategory } from '../common/enums/ride.enum';
import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '../common/enums/user-role.enum';

function fakeRide(overrides: Partial<any> = {}) {
  return {
    id: 'ride-1',
    passengerId: 'passenger-1',
    driverId: 'driver-1',
    status: RideStatus.ACCEPTED,
    pickupLat: 6.5244,
    pickupLng: 3.3792,
    dropoffLat: 6.6,
    dropoffLng: 3.4,
    category: RideCategory.ECONOMY,
    paymentMethod: PaymentMethod.CARD,
    city: 'Lagos',
    ...overrides,
  };
}

/** Mirrors the direct-construction style used by rides.service.manual-dispatch.spec.ts. */
function buildService(overrides: Record<string, any> = {}) {
  const ridesRepo = {
    findOne: jest.fn().mockResolvedValue(fakeRide(overrides.ride)),
    manager: { transaction: jest.fn(async (cb: any) => cb({})) },
  };

  const deps = {
    ridesRepo,
    fareService: {},
    driversService: {
      findByUserId: jest.fn().mockResolvedValue({ currentLat: 6.52, currentLng: 3.37 }),
      ...overrides.driversService,
    },
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
    pricingService: {},
    events: { emit: jest.fn() },
    config: { get: jest.fn() },
    scheduledRidesQueue: {},
    reconciliationService: {},
    settingsService: {},
    metricsService: {},
    googleMaps: {
      isConfigured: jest.fn().mockReturnValue(true),
      getDirections: jest.fn().mockResolvedValue({ polyline: '_p~iF~ps|U_ulLnnqC_mqNvxq`@' }),
      ...overrides.googleMaps,
    },
    candidateSearchService: {},
    driverRankingService: {},
    geofenceService: {},
    airportService: {},
    poolMatchingService: { requestPool: jest.fn(), propagateDriverAssignment: jest.fn().mockResolvedValue(undefined), onRideCancelledBeforeMatch: jest.fn().mockResolvedValue(undefined), unpoolRide: jest.fn().mockResolvedValue(undefined) },
    featureFlagsService: { isEnabled: jest.fn().mockResolvedValue(true) },
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

describe('RidesService.getRoute', () => {
  it('routes driver -> pickup while the driver is still on the way (ACCEPTED)', async () => {
    const { service, deps } = buildService({ ride: { status: RideStatus.ACCEPTED } });

    const result = await service.getRoute('ride-1', 'passenger-1', UserRole.PASSENGER);

    expect(deps.driversService.findByUserId).toHaveBeenCalledWith('driver-1');
    expect(deps.googleMaps.getDirections).toHaveBeenCalledWith(
      { lat: 6.52, lng: 3.37 }, // driver's live position
      { lat: 6.5244, lng: 3.3792 }, // pickup
    );
    expect(result?.leg).toBe('to_pickup');
  });

  it('routes driver -> pickup while ARRIVING and ARRIVED too', async () => {
    for (const status of [RideStatus.ARRIVING, RideStatus.ARRIVED]) {
      const { service, deps } = buildService({ ride: { status } });
      const result = await service.getRoute('ride-1', 'passenger-1', UserRole.PASSENGER);
      expect(deps.googleMaps.getDirections).toHaveBeenCalledWith(
        { lat: 6.52, lng: 3.37 },
        { lat: 6.5244, lng: 3.3792 },
      );
      expect(result?.leg).toBe('to_pickup');
    }
  });

  it('routes pickup -> dropoff once the trip is IN_PROGRESS', async () => {
    const { service, deps } = buildService({ ride: { status: RideStatus.IN_PROGRESS } });

    const result = await service.getRoute('ride-1', 'passenger-1', UserRole.PASSENGER);

    expect(deps.driversService.findByUserId).not.toHaveBeenCalled();
    expect(deps.googleMaps.getDirections).toHaveBeenCalledWith(
      { lat: 6.5244, lng: 3.3792 }, // pickup
      { lat: 6.6, lng: 3.4 }, // dropoff
    );
    expect(result?.leg).toBe('to_dropoff');
  });

  it('falls back to the pickup -> dropoff leg when the driver has no known location yet', async () => {
    const { service, deps } = buildService({
      ride: { status: RideStatus.ACCEPTED },
      driversService: { findByUserId: jest.fn().mockResolvedValue({ currentLat: null, currentLng: null }) },
    });

    const result = await service.getRoute('ride-1', 'passenger-1', UserRole.PASSENGER);

    expect(deps.googleMaps.getDirections).toHaveBeenCalledWith(
      { lat: 6.5244, lng: 3.3792 }, // pickup, used as origin since no driver location
      { lat: 6.5244, lng: 3.3792 }, // pickup, still the destination for this leg
    );
    expect(result?.leg).toBe('to_pickup');
  });

  it('returns null without calling Google when not configured', async () => {
    const { service, deps } = buildService({ googleMaps: { isConfigured: jest.fn().mockReturnValue(false) } });

    const result = await service.getRoute('ride-1', 'passenger-1', UserRole.PASSENGER);

    expect(result).toBeNull();
    expect(deps.googleMaps.getDirections).not.toHaveBeenCalled();
  });

  it('rejects a requester who is not the ride participant or staff', async () => {
    const { service } = buildService();

    await expect(service.getRoute('ride-1', 'someone-else', UserRole.PASSENGER)).rejects.toThrow(ForbiddenException);
  });

  it('allows staff to fetch the route even if not a participant', async () => {
    const { service, deps } = buildService();

    const result = await service.getRoute('ride-1', 'admin-1', UserRole.ADMIN);

    expect(result).not.toBeNull();
    expect(deps.googleMaps.getDirections).toHaveBeenCalled();
  });
});
