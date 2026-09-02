import { RidesService } from './rides.service';
import { RideStatus, PaymentMethod, RideCategory } from '../common/enums/ride.enum';
import { DriverApprovalStatus, DriverAvailability } from '../common/enums/driver-status.enum';
import { DriverService } from '../common/enums/driver-service.enum';
import { DriverLevel } from '../common/enums/driver-level.enum';
import { VehicleCategory, VehicleStatus } from '../common/enums/vehicle.enum';
import { DispatchMode } from '../candidate-search/candidate-search.types';
import { BadRequestException, ForbiddenException } from '@nestjs/common';

function fakeRide(overrides: Partial<any> = {}) {
  return {
    id: 'ride-1',
    passengerId: 'passenger-1',
    status: RideStatus.SEARCHING,
    pickupLat: 6.5244,
    pickupLng: 3.3792,
    category: RideCategory.ECONOMY,
    paymentMethod: PaymentMethod.CARD,
    city: 'Lagos',
    ...overrides,
  };
}

function fakeCandidate(overrides: Partial<any> = {}) {
  return {
    driverUserId: 'driver-1',
    driverProfileId: 'profile-1',
    vehicleId: 'vehicle-1',
    vehicleCategory: VehicleCategory.CAR,
    lat: 6.5244,
    lng: 3.3792,
    distanceKm: 2,
    rating: 4.8,
    level: DriverLevel.STANDARD,
    ...overrides,
  };
}

/**
 * Builds a RidesService with every dependency stubbed out. Individual
 * tests override just the collaborators relevant to what they're
 * checking — this mirrors the direct-construction style already used by
 * other service specs in this codebase (e.g. dispatch-ai.service.spec.ts)
 * rather than pulling in the full Nest Testing module for a service with
 * this many collaborators.
 */
function buildService(overrides: Record<string, any> = {}) {
  const ridesRepo = {
    findOne: jest.fn(),
    manager: {
      transaction: jest.fn(async (cb: any) => cb(overrides.manager ?? {})),
    },
    ...overrides.ridesRepo,
  };

  const deps = {
    ridesRepo,
    fareService: {},
    driversService: {
      findByUserId: jest.fn(),
      reserveOnlineDriverForTrip: jest.fn(),
      emitReservedForTrip: jest.fn(),
      ...overrides.driversService,
    },
    vehiclesService: { findById: jest.fn(), ...overrides.vehiclesService },
    walletsService: {},
    commissionService: {},
    usersService: {
      findByIds: jest.fn().mockResolvedValue([]),
      findById: jest.fn().mockResolvedValue({ id: 'driver-1', firstName: 'Ada' }),
      ...overrides.usersService,
    },
    paymentsService: {},
    corporateService: {},
    passengersService: {},
    promotionsService: {},
    fleetService: {},
    dispatchService: {
      offerToSpecificDriver: jest.fn(),
      getPendingOfferForRide: jest.fn().mockResolvedValue(null),
      hasEverHadOffer: jest.fn().mockResolvedValue(false),
      markAccepted: jest.fn().mockResolvedValue(undefined),
      ...overrides.dispatchService,
    },
    autoDispatchService: {
      startForRide: jest.fn().mockResolvedValue(undefined),
      ...overrides.autoDispatchService,
    },
    pricingService: {},
    events: { emit: jest.fn() },
    config: { get: jest.fn() },
    scheduledRidesQueue: {},
    reconciliationService: {
      getOutstandingBalance: jest.fn().mockResolvedValue({ totalOwed: '0' }),
    },
    settingsService: { getNumber: jest.fn().mockResolvedValue(5000) },
    metricsService: {
      autoDispatchOffersAcceptedTotal: { inc: jest.fn() },
      dispatchLatencySeconds: { startTimer: jest.fn(() => jest.fn()) },
    },
    googleMaps: {},
    candidateSearchService: { search: jest.fn(), ...overrides.candidateSearchService },
    driverRankingService: { rank: jest.fn(), ...overrides.driverRankingService },
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
  );

  return { service, deps };
}

describe('RidesService — manual driver selection', () => {
  describe('findSelectableDrivers', () => {
    it('returns only the ranked, eligible candidates the shared pipeline produced', async () => {
      const ride = fakeRide();
      const { service, deps } = buildService();
      deps.ridesRepo.findOne.mockResolvedValue(ride);
      deps.candidateSearchService.search.mockResolvedValue({
        candidates: [fakeCandidate()],
        radiusUsedKm: 8,
        roundsAttempted: 1,
      });
      deps.driverRankingService.rank.mockResolvedValue({
        ranked: [{ ...fakeCandidate(), etaMinutes: 6 }],
        routingCallsMade: 1,
        routingFailures: 0,
        fallbackUsed: false,
      });
      deps.usersService.findByIds.mockResolvedValue([
        { id: 'driver-1', firstName: 'Ada', lastName: 'Okoye' },
      ]);
      deps.vehiclesService.findById.mockResolvedValue({
        id: 'vehicle-1',
        make: 'Toyota',
        model: 'Corolla',
        color: 'Black',
        plateNumber: 'ABC-123',
      });

      const result = await service.findSelectableDrivers('ride-1');

      expect(result).toEqual([
        {
          driverUserId: 'driver-1',
          firstName: 'Ada',
          lastName: 'Okoye',
          rating: 4.8,
          level: DriverLevel.STANDARD,
          distanceKm: 2,
          etaMinutes: 6,
          vehicleMake: 'Toyota',
          vehicleModel: 'Corolla',
          vehicleColor: 'Black',
          vehiclePlateNumber: 'ABC-123',
        },
      ]);

      // The pipeline was called for the RIDE domain with this ride's category — not
      // hand-rolled Postgres scanning.
      expect(deps.candidateSearchService.search).toHaveBeenCalledWith(
        expect.objectContaining({ rideCategory: RideCategory.ECONOMY }),
      );
    });

    it('returns an empty list without calling the ranking layer when no candidates are eligible', async () => {
      const { service, deps } = buildService();
      deps.ridesRepo.findOne.mockResolvedValue(fakeRide());
      deps.candidateSearchService.search.mockResolvedValue({
        candidates: [],
        radiusUsedKm: 15,
        roundsAttempted: 3,
      });

      const result = await service.findSelectableDrivers('ride-1');

      expect(result).toEqual([]);
      expect(deps.driverRankingService.rank).not.toHaveBeenCalled();
    });
  });

  describe('selectDriver', () => {
    it('offers the ride to exactly the driver the passenger picked, and only that driver', async () => {
      const { service, deps } = buildService();
      deps.ridesRepo.findOne.mockResolvedValue(fakeRide());
      deps.candidateSearchService.search.mockResolvedValue({
        candidates: [fakeCandidate({ driverUserId: 'driver-1' }), fakeCandidate({ driverUserId: 'driver-2' })],
        radiusUsedKm: 8,
        roundsAttempted: 1,
      });

      await service.selectDriver('ride-1', 'passenger-1', 'driver-1');

      expect(deps.dispatchService.offerToSpecificDriver).toHaveBeenCalledTimes(1);
      expect(deps.dispatchService.offerToSpecificDriver).toHaveBeenCalledWith('ride-1', 'driver-1', 2);
    });

    it('rejects a stale selection (driver no longer in the eligible pool) instead of silently offering to someone else', async () => {
      const { service, deps } = buildService();
      deps.ridesRepo.findOne.mockResolvedValue(fakeRide());
      deps.candidateSearchService.search.mockResolvedValue({
        candidates: [fakeCandidate({ driverUserId: 'driver-2' })], // driver-1 no longer there
        radiusUsedKm: 15,
        roundsAttempted: 3,
      });

      await expect(service.selectDriver('ride-1', 'passenger-1', 'driver-1')).rejects.toThrow(BadRequestException);
      expect(deps.dispatchService.offerToSpecificDriver).not.toHaveBeenCalled();
    });

    it('rejects selection from someone who is not the ride owner', async () => {
      const { service, deps } = buildService();
      deps.ridesRepo.findOne.mockResolvedValue(fakeRide({ passengerId: 'someone-else' }));

      await expect(service.selectDriver('ride-1', 'passenger-1', 'driver-1')).rejects.toThrow(ForbiddenException);
      expect(deps.candidateSearchService.search).not.toHaveBeenCalled();
    });

    it('rejects selection once the ride has moved past SEARCHING', async () => {
      const { service, deps } = buildService();
      deps.ridesRepo.findOne.mockResolvedValue(fakeRide({ status: RideStatus.ACCEPTED }));

      await expect(service.selectDriver('ride-1', 'passenger-1', 'driver-1')).rejects.toThrow(BadRequestException);
      expect(deps.candidateSearchService.search).not.toHaveBeenCalled();
    });

    it('never falls back to auto-dispatch when no eligible drivers remain — it surfaces an error for the passenger to retry, not a different driver', async () => {
      const { service, deps } = buildService();
      deps.ridesRepo.findOne.mockResolvedValue(fakeRide());
      deps.candidateSearchService.search.mockResolvedValue({ candidates: [], radiusUsedKm: 15, roundsAttempted: 3 });

      await expect(service.selectDriver('ride-1', 'passenger-1', 'driver-1')).rejects.toThrow(BadRequestException);
      expect(deps.dispatchService.offerToSpecificDriver).not.toHaveBeenCalled();
    });
  });
});

describe('RidesService — acceptRide atomic driver reservation', () => {
  function fakeManager(overrides: Partial<any> = {}) {
    const queryBuilder: any = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    return {
      createQueryBuilder: jest.fn(() => queryBuilder),
      findOneOrFail: jest.fn().mockResolvedValue(fakeRide({ status: RideStatus.ACCEPTED })),
      __queryBuilder: queryBuilder,
      ...overrides,
    };
  }

  function baseDeps(manager: any) {
    return {
      manager,
      driversService: {
        findByUserId: jest.fn().mockResolvedValue({
          approvalStatus: DriverApprovalStatus.APPROVED,
          availability: DriverAvailability.ONLINE_FOR_RIDES,
          activeVehicleId: 'vehicle-1',
        }),
        reserveOnlineDriverForTrip: jest.fn().mockResolvedValue({
          userId: 'driver-1',
          id: 'profile-1',
          activeVehicleId: 'vehicle-1',
        }),
        emitReservedForTrip: jest.fn(),
      },
      vehiclesService: {
        findById: jest.fn().mockResolvedValue({ id: 'vehicle-1', category: VehicleCategory.CAR, status: VehicleStatus.ACTIVE }),
      },
    };
  }

  it('reserves the driver and claims the ride inside a single transaction, then emits the availability change only after it commits', async () => {
    const manager = fakeManager();
    const { service, deps } = buildService(baseDeps(manager));
    deps.ridesRepo.findOne.mockResolvedValue(fakeRide());

    const result = await service.acceptRide('ride-1', 'driver-1');

    expect(deps.driversService.reserveOnlineDriverForTrip).toHaveBeenCalledWith(manager, 'driver-1', DriverService.RIDE);
    expect(manager.__queryBuilder.execute).toHaveBeenCalled();
    expect(deps.driversService.emitReservedForTrip).toHaveBeenCalledTimes(1);
    expect(result.status).toBe(RideStatus.ACCEPTED);
  });

  it('rejects acceptance when the driver\'s vehicle exists but is not ACTIVE (e.g. still pending inspection, or deactivated) - real gap found via the admin-dispatch candidates endpoint: this same driver correctly never appeared as an eligible dispatch candidate, but the open accept path had no matching check, so they could still accept directly', async () => {
    const manager = fakeManager();
    const deps = baseDeps(manager);
    deps.vehiclesService.findById = jest.fn().mockResolvedValue({
      id: 'vehicle-1',
      category: VehicleCategory.CAR,
      status: VehicleStatus.PENDING_INSPECTION,
    });
    const { service, deps: allDeps } = buildService(deps);
    allDeps.ridesRepo.findOne.mockResolvedValue(fakeRide());

    await expect(service.acceptRide('ride-1', 'driver-1')).rejects.toThrow(
      /not active/,
    );
    expect(allDeps.driversService.reserveOnlineDriverForTrip).not.toHaveBeenCalled();
  });

  it('auto_offer_accept_rate (batch 9): counts an AUTO ride reaching ACCEPTED, but not a MANUAL one', async () => {
    const autoManager = fakeManager({
      findOneOrFail: jest.fn().mockResolvedValue(fakeRide({ status: RideStatus.ACCEPTED, dispatchMode: DispatchMode.AUTO })),
    });
    const { service: autoService, deps: autoDeps } = buildService(baseDeps(autoManager));
    autoDeps.ridesRepo.findOne.mockResolvedValue(fakeRide({ dispatchMode: DispatchMode.AUTO }));

    await autoService.acceptRide('ride-1', 'driver-1');

    expect(autoDeps.metricsService.autoDispatchOffersAcceptedTotal.inc).toHaveBeenCalledTimes(1);

    const manualManager = fakeManager({
      findOneOrFail: jest.fn().mockResolvedValue(fakeRide({ status: RideStatus.ACCEPTED, dispatchMode: DispatchMode.MANUAL })),
    });
    const { service: manualService, deps: manualDeps } = buildService(baseDeps(manualManager));
    manualDeps.ridesRepo.findOne.mockResolvedValue(fakeRide({ dispatchMode: DispatchMode.MANUAL }));

    await manualService.acceptRide('ride-1', 'driver-1');

    expect(manualDeps.metricsService.autoDispatchOffersAcceptedTotal.inc).not.toHaveBeenCalled();
  });

  it('rolls back cleanly (no emit, no partial state) when the driver reservation itself fails — e.g. lost the race to another booking', async () => {
    const manager = fakeManager();
    const deps = baseDeps(manager);
    deps.driversService.reserveOnlineDriverForTrip = jest
      .fn()
      .mockRejectedValue(new BadRequestException('Driver is no longer available'));

    const { service, deps: allDeps } = buildService(deps);
    allDeps.ridesRepo.findOne.mockResolvedValue(fakeRide());

    await expect(service.acceptRide('ride-1', 'driver-1')).rejects.toThrow(BadRequestException);

    // The ride-claim UPDATE must never even be attempted once the driver
    // reservation itself has already failed.
    expect(manager.createQueryBuilder).not.toHaveBeenCalled();
    expect(allDeps.driversService.emitReservedForTrip).not.toHaveBeenCalled();
  });

  it('rolls back (no emit) when the ride was claimed by someone else a moment earlier, even though the driver reservation succeeded', async () => {
    const manager = fakeManager();
    manager.__queryBuilder.execute.mockResolvedValue({ affected: 0 });
    const deps = baseDeps(manager);

    const { service, deps: allDeps } = buildService(deps);
    allDeps.ridesRepo.findOne.mockResolvedValue(fakeRide());

    await expect(service.acceptRide('ride-1', 'driver-1')).rejects.toThrow(
      'This ride was just accepted by another driver.',
    );

    expect(allDeps.driversService.emitReservedForTrip).not.toHaveBeenCalled();
  });

  it('two concurrent acceptRide calls for the same driver on different rides: only one can win the reservation', async () => {
    // Simulates the actual race: reserveOnlineDriverForTrip is the real
    // atomic guard, so its mock here behaves like the underlying
    // conditional UPDATE would — first caller succeeds, every
    // subsequent caller for the same (now non-ONLINE) driver fails.
    const manager1 = fakeManager();
    const manager2 = fakeManager();
    let reserved = false;
    const reserveOnlineDriverForTrip = jest.fn(async () => {
      if (reserved) {
        throw new BadRequestException('Driver is no longer available — they may already be on another trip.');
      }
      reserved = true;
      return { userId: 'driver-1', id: 'profile-1', activeVehicleId: 'vehicle-1' };
    });

    const { service: serviceA, deps: depsA } = buildService({
      manager: manager1,
      driversService: {
        findByUserId: jest.fn().mockResolvedValue({
          approvalStatus: DriverApprovalStatus.APPROVED,
          availability: DriverAvailability.ONLINE_FOR_RIDES,
          activeVehicleId: 'vehicle-1',
        }),
        reserveOnlineDriverForTrip,
        emitReservedForTrip: jest.fn(),
      },
      vehiclesService: { findById: jest.fn().mockResolvedValue({ id: 'vehicle-1', category: VehicleCategory.CAR, status: VehicleStatus.ACTIVE }) },
    });
    depsA.ridesRepo.findOne.mockResolvedValue(fakeRide({ id: 'ride-a' }));

    const { service: serviceB, deps: depsB } = buildService({
      manager: manager2,
      driversService: {
        findByUserId: jest.fn().mockResolvedValue({
          approvalStatus: DriverApprovalStatus.APPROVED,
          availability: DriverAvailability.ONLINE_FOR_RIDES,
          activeVehicleId: 'vehicle-1',
        }),
        reserveOnlineDriverForTrip,
        emitReservedForTrip: jest.fn(),
      },
      vehiclesService: { findById: jest.fn().mockResolvedValue({ id: 'vehicle-1', category: VehicleCategory.CAR, status: VehicleStatus.ACTIVE }) },
    });
    depsB.ridesRepo.findOne.mockResolvedValue(fakeRide({ id: 'ride-b' }));

    const [resultA, resultB] = await Promise.allSettled([
      serviceA.acceptRide('ride-a', 'driver-1'),
      serviceB.acceptRide('ride-b', 'driver-1'),
    ]);

    const outcomes = [resultA.status, resultB.status];
    expect(outcomes.filter((s) => s === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((s) => s === 'rejected')).toHaveLength(1);
  });
});
