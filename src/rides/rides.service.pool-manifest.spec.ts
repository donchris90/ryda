import { RidesService } from './rides.service';
import { RideStatus } from '../common/enums/ride.enum';
import { UserRole } from '../common/enums/user-role.enum';
import { ForbiddenException } from '@nestjs/common';

// Same buildService() shape as rides.service.remaining-methods.spec.ts —
// kept as its own copy per the existing per-file convention (cancel-race
// and manual-dispatch each have their own too).
function buildService(overrides: Record<string, any> = {}) {
  const ridesRepo = {
    findOne: jest.fn(),
    save: jest.fn(async (data: any) => data),
    delete: jest.fn().mockResolvedValue(undefined),
    manager: {
      transaction: jest.fn(async (cb: any) => cb(overrides.manager ?? {})),
    },
    ...overrides.ridesRepo,
  };

  const deps = {
    ridesRepo,
    fareService: {},
    driversService: {},
    vehiclesService: {},
    walletsService: {},
    commissionService: {},
    usersService: {
      findById: jest.fn().mockResolvedValue({ id: 'partner-passenger-1', firstName: 'Ada' }),
      ...overrides.usersService,
    },
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
    googleMaps: {},
    candidateSearchService: {},
    driverRankingService: {},
    geofenceService: {},
    airportService: {},
    poolMatchingService: {
      getGroupAndPartner: jest.fn(),
      ...overrides.poolMatchingService,
    },
    featureFlagsService: {},
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
    deps.poolMatchingService as any,
    deps.featureFlagsService as any,
  );

  return { service, deps };
}

function fakePooledRide(overrides: Record<string, any> = {}) {
  return {
    id: 'ride-1',
    passengerId: 'passenger-1',
    driverId: 'driver-1',
    status: RideStatus.IN_PROGRESS,
    isPooled: true,
    poolGroupId: 'group-1',
    ...overrides,
  };
}

function fakeGroupAndPartner() {
  return {
    group: {
      routeSequence: [
        { type: 'pickup', rideId: 'ride-1', lat: 1, lng: 1, address: 'A' },
        { type: 'pickup', rideId: 'partner-ride-1', lat: 2, lng: 2, address: 'B' },
        { type: 'dropoff', rideId: 'ride-1', lat: 3, lng: 3, address: 'C' },
        { type: 'dropoff', rideId: 'partner-ride-1', lat: 4, lng: 4, address: 'D' },
      ],
    },
    partnerRide: {
      id: 'partner-ride-1',
      passengerId: 'partner-passenger-1',
      status: RideStatus.IN_PROGRESS,
    },
  };
}

describe('RidesService.getPoolManifest', () => {
  // This is the gap the passenger app's old ride.stops-based pooling
  // display let go unverified: unlike the driver path (exercised via the
  // driver app screen), nothing asserted that a passenger on their own
  // pooled ride could actually read it. Both participant sides go through
  // the exact same isParticipant check, but that symmetry was never
  // pinned down in a test — so a regression narrowing it to drivers only
  // would have shipped silently.
  it('allows the ride passenger to read the manifest', async () => {
    const ride = fakePooledRide();
    const { service, deps } = buildService({
      ridesRepo: { findOne: jest.fn().mockResolvedValue(ride) },
      poolMatchingService: {
        getGroupAndPartner: jest.fn().mockResolvedValue(fakeGroupAndPartner()),
      },
    });

    const manifest = await service.getPoolManifest('ride-1', 'passenger-1', UserRole.PASSENGER);

    expect(manifest).not.toBeNull();
    expect(manifest!.partnerRideId).toBe('partner-ride-1');
    expect(manifest!.partnerFirstName).toBe('Ada');
    expect(deps.poolMatchingService.getGroupAndPartner).toHaveBeenCalledWith(ride);
  });

  it('allows the assigned driver to read the manifest', async () => {
    const ride = fakePooledRide();
    const { service } = buildService({
      ridesRepo: { findOne: jest.fn().mockResolvedValue(ride) },
      poolMatchingService: {
        getGroupAndPartner: jest.fn().mockResolvedValue(fakeGroupAndPartner()),
      },
    });

    const manifest = await service.getPoolManifest('ride-1', 'driver-1', UserRole.DRIVER);

    expect(manifest).not.toBeNull();
    expect(manifest!.stops).toHaveLength(4);
  });

  it('rejects a requester who is neither a participant nor staff', async () => {
    const ride = fakePooledRide();
    const { service } = buildService({
      ridesRepo: { findOne: jest.fn().mockResolvedValue(ride) },
    });

    await expect(
      service.getPoolManifest('ride-1', 'some-other-user', UserRole.PASSENGER),
    ).rejects.toThrow(ForbiddenException);
  });

  it('returns null for a non-pooled ride even for its own passenger', async () => {
    const ride = fakePooledRide({ isPooled: false, poolGroupId: null });
    const { service, deps } = buildService({
      ridesRepo: { findOne: jest.fn().mockResolvedValue(ride) },
    });

    const manifest = await service.getPoolManifest('ride-1', 'passenger-1', UserRole.PASSENGER);

    expect(manifest).toBeNull();
    expect(deps.poolMatchingService.getGroupAndPartner).not.toHaveBeenCalled();
  });
});
