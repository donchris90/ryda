import { RidesService } from './rides.service';
import {
  RideStatus,
  PaymentMethod,
  CancelledBy,
  RideCategory,
} from '../common/enums/ride.enum';
import { DriverAvailability } from '../common/enums/driver-status.enum';
import { BadRequestException } from '@nestjs/common';

function fakeRide(overrides: Partial<any> = {}) {
  return {
    id: 'ride-1',
    passengerId: 'passenger-1',
    driverId: null,
    status: RideStatus.SEARCHING,
    pickupLat: 6.5244,
    pickupLng: 3.3792,
    category: RideCategory.ECONOMY,
    paymentMethod: PaymentMethod.CARD,
    city: 'Lagos',
    cancellationFee: null,
    ...overrides,
  };
}

/**
 * Same direct-construction style as rides.service.manual-dispatch.spec.ts —
 * only the collaborators cancelRide() actually touches are stubbed.
 */
function buildService(overrides: Record<string, any> = {}) {
  const queryBuilder: any = {
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({ affected: 1 }),
  };

  const ridesRepo = {
    findOne: jest.fn(),
    createQueryBuilder: jest.fn(() => queryBuilder),
    update: jest.fn().mockResolvedValue(undefined),
    ...overrides.ridesRepo,
  };

  const deps = {
    ridesRepo,
    fareService: { getCancellationFee: jest.fn().mockResolvedValue(500) },
    driversService: {
      findByUserId: jest
        .fn()
        .mockResolvedValue({ id: 'profile-1', fleetCompanyId: null }),
      recordTripOutcome: jest.fn(),
      setAvailability: jest.fn(),
      restoreAvailabilityAfterTrip: jest.fn(),
      ...overrides.driversService,
    },
    vehiclesService: {},
    walletsService: {
      getByUserId: jest.fn().mockResolvedValue({ id: 'wallet-1' }),
      debit: jest.fn().mockResolvedValue(undefined),
      credit: jest.fn().mockResolvedValue(undefined),
      ...overrides.walletsService,
    },
    commissionService: {},
    usersService: {},
    paymentsService: {},
    corporateService: {},
    passengersService: { recordTripOutcome: jest.fn() },
    promotionsService: {},
    fleetService: { creditForRideEarning: jest.fn() },
    dispatchService: {},
    autoDispatchService: {},
    pricingService: {},
    events: { emit: jest.fn() },
    config: { get: jest.fn() },
    scheduledRidesQueue: { getJob: jest.fn() },
    reconciliationService: {},
    settingsService: {},
    metricsService: { rideCancellationsTotal: { inc: jest.fn() } },
    googleMaps: {},
    candidateSearchService: {},
    driverRankingService: {},
    poolMatchingService: {
      requestPool: jest.fn(),
      propagateDriverAssignment: jest.fn().mockResolvedValue(undefined),
      onRideCancelledBeforeMatch: jest.fn().mockResolvedValue(undefined),
      unpoolRide: jest.fn().mockResolvedValue(undefined),
      unpoolRideMidTrip: jest.fn().mockResolvedValue(undefined),
    },
    featureFlagsService: { isEnabled: jest.fn().mockResolvedValue(true) },
  };

  const service = new RidesService(
    deps.ridesRepo,
    deps.fareService as any,
    deps.driversService,
    deps.vehiclesService as any,
    deps.walletsService,
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
    deps.poolMatchingService as any,
    deps.featureFlagsService as any,
  );

  return { service, deps, queryBuilder };
}

describe('RidesService.cancelRide — atomic cancellation claim (batch 9)', () => {
  it('claims the cancellation via a conditional UPDATE scoped to the ride id and the status just read', async () => {
    const { service, deps, queryBuilder } = buildService();
    deps.ridesRepo.findOne.mockResolvedValue(
      fakeRide({ status: RideStatus.SEARCHING }),
    );

    await service.cancelRide(
      'ride-1',
      'passenger-1',
      CancelledBy.PASSENGER,
      {},
    );

    expect(queryBuilder.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: RideStatus.CANCELLED }),
    );
    expect(queryBuilder.where).toHaveBeenCalledWith('id = :id', {
      id: 'ride-1',
    });
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      'status = :originalStatus',
      {
        originalStatus: RideStatus.SEARCHING,
      },
    );
  });

  it('throws and does not touch wallets/driver state when the ride changed status underneath it (e.g. a concurrent acceptRide won first)', async () => {
    const { service, deps, queryBuilder } = buildService();
    deps.ridesRepo.findOne.mockResolvedValue(
      fakeRide({ status: RideStatus.SEARCHING, driverId: 'driver-1' }),
    );
    queryBuilder.execute.mockResolvedValue({ affected: 0 });

    await expect(
      service.cancelRide('ride-1', 'passenger-1', CancelledBy.PASSENGER, {}),
    ).rejects.toThrow(BadRequestException);

    // Nothing past the failed claim should have run — no fee charged, no
    // driver put back online, no cancellation event fired. A losing
    // cancel attempt must have zero side effects, not a half-applied one.
    expect(deps.walletsService.debit).not.toHaveBeenCalled();
    expect(deps.driversService.setAvailability).not.toHaveBeenCalled();
    expect(deps.events.emit).not.toHaveBeenCalled();
    expect(
      deps.metricsService.rideCancellationsTotal.inc,
    ).not.toHaveBeenCalled();
  });

  it('two concurrent cancelRide calls for the same ride: only one can win the atomic claim', async () => {
    // Simulates the real race the way the acceptRide equivalent test does:
    // a single shared "row" whose conditional UPDATE only succeeds once,
    // exactly like Postgres would enforce it.
    let currentStatus: RideStatus = RideStatus.SEARCHING;
    let claims = 0;

    const sharedQueryBuilder: any = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn(function (
        this: any,
        _clause: string,
        params: { originalStatus: RideStatus },
      ) {
        this.__expectedStatus = params.originalStatus;
        return this;
      }),
      execute: jest.fn(async function (this: any) {
        if (currentStatus === this.__expectedStatus) {
          currentStatus = RideStatus.CANCELLED;
          claims += 1;
          return { affected: 1 };
        }
        return { affected: 0 };
      }),
    };

    const buildRacer = () =>
      buildService({
        ridesRepo: {
          findOne: jest
            .fn()
            .mockResolvedValue(fakeRide({ status: RideStatus.SEARCHING })),
          createQueryBuilder: jest.fn(() => sharedQueryBuilder),
          update: jest.fn().mockResolvedValue(undefined),
        },
      });

    const { service: serviceA } = buildRacer();
    const { service: serviceB } = buildRacer();

    const results = await Promise.allSettled([
      serviceA.cancelRide('ride-1', 'passenger-1', CancelledBy.PASSENGER, {}),
      serviceB.cancelRide('ride-1', 'passenger-1', CancelledBy.PASSENGER, {}),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(claims).toBe(1);
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(BadRequestException);
  });

  it('does not overwrite a ride that was accepted by another driver in between the read and the claim (the original lost-update scenario)', async () => {
    const { service, deps, queryBuilder } = buildService();
    // findById() read the ride while it was still SEARCHING...
    deps.ridesRepo.findOne.mockResolvedValue(
      fakeRide({ status: RideStatus.SEARCHING, driverId: 'driver-1' }),
    );
    // ...but by the time the claim runs, acceptRide() already committed
    // SEARCHING -> ACCEPTED in another transaction, so the conditional
    // UPDATE (WHERE status = SEARCHING) matches nothing.
    queryBuilder.execute.mockResolvedValue({ affected: 0 });

    await expect(
      service.cancelRide('ride-1', 'passenger-1', CancelledBy.PASSENGER, {}),
    ).rejects.toThrow('This ride just changed status');

    // Confirms this really is the fix for the lost-update bug: the driver
    // that acceptRide() just reserved ON_TRIP is never silently restored
    // to online by this losing cancel attempt.
    expect(
      deps.driversService.restoreAvailabilityAfterTrip,
    ).not.toHaveBeenCalled();
  });
});

describe('RidesService.cancelRide — mid-trip pool cancellation', () => {
  it('unwinds the partner side via PoolMatchingService when a driver is already assigned to both pooled rides', async () => {
    const { service, deps } = buildService();
    deps.ridesRepo.findOne.mockResolvedValue(
      fakeRide({
        status: RideStatus.IN_PROGRESS,
        driverId: 'driver-1',
        poolGroupId: 'group-1',
      }),
    );

    await service.cancelRide(
      'ride-1',
      'passenger-1',
      CancelledBy.PASSENGER,
      {},
    );

    expect(deps.poolMatchingService.unpoolRideMidTrip).toHaveBeenCalledWith(
      'ride-1',
      expect.stringContaining('ride-1'),
    );
    // The other, earlier-stage pool hooks must NOT also fire for this case.
    expect(
      deps.poolMatchingService.onRideCancelledBeforeMatch,
    ).not.toHaveBeenCalled();
    expect(deps.poolMatchingService.unpoolRide).not.toHaveBeenCalled();
  });

  it.each([
    RideStatus.ACCEPTED,
    RideStatus.ARRIVING,
    RideStatus.ARRIVED,
    RideStatus.IN_PROGRESS,
  ])(
    'does not restore driver availability when cancelling from %s with an active pool partner (driver is still on-trip with them)',
    async (status) => {
      const { service, deps } = buildService();
      deps.ridesRepo.findOne.mockResolvedValue(
        fakeRide({ status, driverId: 'driver-1', poolGroupId: 'group-1' }),
      );

      await service.cancelRide(
        'ride-1',
        'passenger-1',
        CancelledBy.PASSENGER,
        {},
      );

      // The ride row itself is still recorded as a cancelled trip for the
      // driver (per-ride accounting)...
      expect(deps.driversService.recordTripOutcome).toHaveBeenCalledWith(
        'profile-1',
        'cancelled',
      );
      // ...but they must NOT be put back on the market while still
      // actively driving the surviving pooled passenger.
      expect(
        deps.driversService.restoreAvailabilityAfterTrip,
      ).not.toHaveBeenCalled();
    },
  );

  it('still restores driver availability for a normal (non-pooled) engaged-driver cancellation', async () => {
    const { service, deps } = buildService();
    deps.ridesRepo.findOne.mockResolvedValue(
      fakeRide({
        status: RideStatus.ACCEPTED,
        driverId: 'driver-1',
        poolGroupId: null,
      }),
    );

    await service.cancelRide(
      'ride-1',
      'passenger-1',
      CancelledBy.PASSENGER,
      {},
    );

    expect(
      deps.driversService.restoreAvailabilityAfterTrip,
    ).toHaveBeenCalledWith('driver-1');
    expect(deps.poolMatchingService.unpoolRideMidTrip).not.toHaveBeenCalled();
  });

  it('notifies the driver with the pool-specific event instead of the generic "ride cancelled" one', async () => {
    const { service, deps } = buildService();
    deps.ridesRepo.findOne.mockResolvedValue(
      fakeRide({
        status: RideStatus.IN_PROGRESS,
        driverId: 'driver-1',
        poolGroupId: 'group-1',
      }),
    );

    await service.cancelRide(
      'ride-1',
      'passenger-1',
      CancelledBy.PASSENGER,
      {},
    );

    expect(deps.events.emit).toHaveBeenCalledWith(
      'ride.pool_partner_cancelled',
      { notifyUserId: 'driver-1' },
    );
    expect(deps.events.emit).not.toHaveBeenCalledWith(
      'ride.cancelled',
      expect.anything(),
    );
  });

  it('falls back to the generic "ride cancelled" notification for a non-pooled cancellation', async () => {
    const { service, deps } = buildService();
    deps.ridesRepo.findOne.mockResolvedValue(
      fakeRide({
        status: RideStatus.SEARCHING,
        driverId: null,
        poolGroupId: null,
        passengerId: 'passenger-1',
      }),
    );

    await service.cancelRide('ride-1', 'passenger-1', CancelledBy.PASSENGER, {
      reason: 'change of plans',
    });

    expect(deps.events.emit).not.toHaveBeenCalledWith(
      'ride.pool_partner_cancelled',
      expect.anything(),
    );
  });

  it('does not touch PoolMatchingService at all for a plain solo ride cancellation', async () => {
    const { service, deps } = buildService();
    deps.ridesRepo.findOne.mockResolvedValue(
      fakeRide({ status: RideStatus.SEARCHING, poolGroupId: null }),
    );

    await service.cancelRide(
      'ride-1',
      'passenger-1',
      CancelledBy.PASSENGER,
      {},
    );

    expect(
      deps.poolMatchingService.onRideCancelledBeforeMatch,
    ).not.toHaveBeenCalled();
    expect(deps.poolMatchingService.unpoolRide).not.toHaveBeenCalled();
    expect(deps.poolMatchingService.unpoolRideMidTrip).not.toHaveBeenCalled();
  });
});
