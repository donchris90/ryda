import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { RidesService } from './rides.service';
import { RideStatus, CancelledBy, PaymentMethod, RideCategory } from '../common/enums/ride.enum';
import { DriverApprovalStatus, DriverAvailability } from '../common/enums/driver-status.enum';
import { VehicleStatus, VehicleCategory } from '../common/enums/vehicle.enum';

function fakeRide(overrides: Record<string, any> = {}) {
  return {
    id: 'ride-1',
    passengerId: 'passenger-1',
    driverId: null,
    vehicleId: null,
    status: RideStatus.SEARCHING,
    category: RideCategory.ECONOMY,
    paymentMethod: PaymentMethod.CASH,
    totalFare: '1000.00',
    city: 'Lagos',
    ...overrides,
  };
}

function fakeDriverProfile(overrides: Record<string, any> = {}) {
  return {
    id: 'profile-1',
    userId: 'driver-1',
    approvalStatus: DriverApprovalStatus.APPROVED,
    availability: DriverAvailability.ONLINE_FOR_RIDES,
    activeVehicleId: 'vehicle-1',
    ...overrides,
  };
}

function buildService(overrides: Record<string, any> = {}) {
  const fakeQueryBuilder = () => ({
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({ affected: 1 }),
  });

  const fakeManager = () => ({
    createQueryBuilder: jest.fn(fakeQueryBuilder),
    findOneOrFail: jest.fn().mockResolvedValue(fakeRide({ driverId: 'driver-1', status: RideStatus.ACCEPTED })),
  });

  const ridesRepo = {
    findOne: jest.fn(),
    save: jest.fn(async (r: any) => r),
    manager: {
      transaction: jest.fn(async (cb: any) => cb(overrides.manager ?? fakeManager())),
    },
    createQueryBuilder: jest.fn(fakeQueryBuilder),
    ...overrides.ridesRepo,
  };

  const deps = {
    ridesRepo,
    fareService: {},
    driversService: {
      findByUserId: jest.fn().mockResolvedValue(fakeDriverProfile()),
      reserveOnlineDriverForTrip: jest.fn().mockResolvedValue(fakeDriverProfile()),
      restoreAvailabilityAfterTrip: jest.fn().mockResolvedValue(undefined),
      recordTripOutcome: jest.fn().mockResolvedValue(undefined),
      emitReservedForTrip: jest.fn(),
    },
    vehiclesService: {
      findById: jest.fn().mockResolvedValue({ id: 'vehicle-1', status: VehicleStatus.ACTIVE, category: VehicleCategory.CAR }),
    },
    walletsService: { getByUserId: jest.fn(), debit: jest.fn() },
    commissionService: {},
    usersService: {
      findById: jest.fn().mockResolvedValue({ id: 'passenger-1', firstName: 'Ada', lastName: 'Bello', phone: '+2340000000', rating: '4.9' }),
      findByIds: jest.fn().mockResolvedValue([]),
    },
    paymentsService: { findByRide: jest.fn().mockResolvedValue([]) },
    corporateService: {},
    passengersService: { recordTripOutcome: jest.fn().mockResolvedValue(undefined) },
    promotionsService: {},
    fleetService: {},
    dispatchService: {
      getPendingOfferForRide: jest.fn().mockResolvedValue(null),
      hasEverHadOffer: jest.fn().mockResolvedValue(false),
      markAccepted: jest.fn().mockResolvedValue(undefined),
    },
    autoDispatchService: {},
    pricingService: {},
    events: { emit: jest.fn() },
    config: { get: jest.fn() },
    scheduledRidesQueue: {},
    reconciliationService: { getOutstandingBalance: jest.fn().mockResolvedValue({ totalOwed: '0' }) },
    settingsService: { getNumber: jest.fn().mockResolvedValue(5000) },
    metricsService: { rideCancellationsTotal: { inc: jest.fn() }, autoDispatchOffersAcceptedTotal: { inc: jest.fn() } },
    googleMaps: {},
    candidateSearchService: {},
    driverRankingService: {},
    geofenceService: { isWithinServiceArea: jest.fn().mockResolvedValue(true), checkPoint: jest.fn().mockResolvedValue([]) },
    ...overrides.deps,
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
    {} as any, // airportService (not exercised by this suite)
    {} as any, // fraudService (not exercised by this suite's scenarios)
    {} as any, // poolMatchingService (not exercised by this suite)
    {} as any, // featureFlagsService (not exercised by this suite)
  );

  return { service, deps };
}

describe('RidesService.getForAdmin()', () => {
  it('returns the ride with passenger, driver, and payment context in one call', async () => {
    const { service, deps } = buildService();
    deps.ridesRepo.findOne.mockResolvedValue(
      fakeRide({ driverId: 'driver-1', vehicleId: 'vehicle-1', status: RideStatus.IN_PROGRESS }),
    );
    deps.usersService.findById
      .mockResolvedValueOnce({ id: 'passenger-1', firstName: 'Ada', lastName: 'Bello', phone: '+234', rating: '4.9' })
      .mockResolvedValueOnce({ id: 'driver-1', firstName: 'Femi', lastName: 'Ade', phone: '+235', rating: null });
    deps.vehiclesService.findById.mockResolvedValue({
      id: 'vehicle-1',
      status: VehicleStatus.ACTIVE,
      category: VehicleCategory.CAR,
      make: 'Toyota',
      model: 'Camry',
      color: 'Black',
      plateNumber: 'LND-123-XY',
    });
    deps.paymentsService.findByRide.mockResolvedValue([{ id: 'pay-1', status: 'success' }]);

    const result = await service.getForAdmin('ride-1');

    expect(result.ride.id).toBe('ride-1');
    expect(result.passenger?.firstName).toBe('Ada');
    expect(result.driver?.firstName).toBe('Femi');
    expect(result.driver?.vehicle).toEqual({ make: 'Toyota', model: 'Camry', color: 'Black', plateNumber: 'LND-123-XY' });
    expect(result.payments).toHaveLength(1);
  });

  it('returns a null driver (not a thrown error) for a ride with no driver assigned yet', async () => {
    const { service, deps } = buildService();
    deps.ridesRepo.findOne.mockResolvedValue(fakeRide({ driverId: null }));

    const result = await service.getForAdmin('ride-1');

    expect(result.driver).toBeNull();
  });

  it('degrades gracefully (nulls, not a thrown error) when a related lookup fails', async () => {
    const { service, deps } = buildService();
    deps.ridesRepo.findOne.mockResolvedValue(fakeRide({ driverId: 'driver-1' }));
    deps.usersService.findById.mockRejectedValue(new Error('user service down'));

    const result = await service.getForAdmin('ride-1');

    expect(result.passenger).toBeNull();
  });
});

describe('RidesService.manualAssignForAdmin() / acceptRide bypassOfferCheck', () => {
  it("assigns the driver even though the ride is currently offered to a DIFFERENT driver - the whole point of the admin override", async () => {
    const { service, deps } = buildService();
    deps.ridesRepo.findOne.mockResolvedValue(fakeRide());
    deps.dispatchService.getPendingOfferForRide.mockResolvedValue({ driverUserId: 'some-other-driver' });

    const result = await service.manualAssignForAdmin('ride-1', 'driver-1');

    expect(result).toBeDefined();
  });

  it("still refuses an unapproved driver - the bypass only skips the offer check, not driver eligibility", async () => {
    const { service, deps } = buildService();
    deps.ridesRepo.findOne.mockResolvedValue(fakeRide());
    deps.driversService.findByUserId.mockResolvedValue(
      fakeDriverProfile({ approvalStatus: DriverApprovalStatus.PENDING }),
    );

    await expect(service.manualAssignForAdmin('ride-1', 'driver-1')).rejects.toThrow(ForbiddenException);
  });

  it('still refuses a driver whose vehicle category does not match the ride', async () => {
    const { service, deps } = buildService();
    deps.ridesRepo.findOne.mockResolvedValue(fakeRide({ category: RideCategory.COMFORT }));
    deps.vehiclesService.findById.mockResolvedValue({ id: 'vehicle-1', status: VehicleStatus.ACTIVE, category: VehicleCategory.MOTORCYCLE });

    await expect(service.manualAssignForAdmin('ride-1', 'driver-1')).rejects.toThrow(BadRequestException);
  });

  it('the ordinary passenger/driver-facing acceptRide() still enforces the offer-exclusivity check by default', async () => {
    const { service, deps } = buildService();
    deps.ridesRepo.findOne.mockResolvedValue(fakeRide());
    deps.dispatchService.getPendingOfferForRide.mockResolvedValue({ driverUserId: 'some-other-driver' });

    await expect(service.acceptRide('ride-1', 'driver-1')).rejects.toThrow(ForbiddenException);
  });
});

describe('RidesService.cancelRide() with CancelledBy.ADMIN', () => {
  it('never charges a cancellation fee for an admin-initiated cancel, even with a driver already engaged', async () => {
    const { service, deps } = buildService();
    deps.ridesRepo.findOne.mockResolvedValue(
      fakeRide({ status: RideStatus.ACCEPTED, driverId: 'driver-1', paymentMethod: PaymentMethod.WALLET }),
    );

    await service.cancelRide('ride-1', 'admin-1', CancelledBy.ADMIN, { reason: 'Duplicate booking' });

    expect(deps.walletsService.getByUserId).not.toHaveBeenCalled();
  });

  it('records the admin as the canceller and stores the given reason', async () => {
    const { service, deps } = buildService();
    const ride = fakeRide({ status: RideStatus.SEARCHING });
    deps.ridesRepo.findOne.mockResolvedValue(ride);

    const result = await service.cancelRide('ride-1', 'admin-1', CancelledBy.ADMIN, { reason: 'Fraud investigation' });

    expect(result.cancelledBy).toBe(CancelledBy.ADMIN);
    expect(result.cancelReason).toBe('Fraud investigation');
  });

  it('does not require the admin to own the ride, unlike a passenger/driver self-cancel', async () => {
    const { service, deps } = buildService();
    deps.ridesRepo.findOne.mockResolvedValue(fakeRide({ passengerId: 'someone-else', status: RideStatus.SEARCHING }));

    await expect(
      service.cancelRide('ride-1', 'admin-1', CancelledBy.ADMIN, { reason: 'ops override' }),
    ).resolves.toBeDefined();
  });
});
