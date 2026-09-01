import { RidesService } from './rides.service';
import { RideStatus, PaymentMethod } from '../common/enums/ride.enum';
import { BadRequestException, ForbiddenException } from '@nestjs/common';

// Same buildService() shape as rides.service.complete-ride.spec.ts — kept
// as its own copy per the existing per-file convention (cancel-race and
// manual-dispatch each have their own too).
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
    driversService: {
      findByUserId: jest.fn(),
      applyRating: jest.fn(),
      restoreAvailabilityAfterTrip: jest.fn().mockResolvedValue(undefined),
      ...overrides.driversService,
    },
    vehiclesService: { findById: jest.fn(), ...overrides.vehiclesService },
    walletsService: {
      getByUserId: jest.fn().mockResolvedValue({ id: 'wallet-1' }),
      debit: jest.fn().mockResolvedValue(undefined),
      credit: jest.fn().mockResolvedValue(undefined),
      ...overrides.walletsService,
    },
    commissionService: {},
    usersService: {
      findByIds: jest.fn().mockResolvedValue([]),
      findById: jest.fn().mockResolvedValue({ id: 'passenger-1', email: 'passenger@example.com' }),
      applyRating: jest.fn(),
      ...overrides.usersService,
    },
    paymentsService: {},
    corporateService: {},
    passengersService: { recordTripOutcome: jest.fn() },
    promotionsService: {},
    fleetService: {},
    dispatchService: {},
    autoDispatchService: {},
    pricingService: {},
    events: { emit: jest.fn(), ...overrides.events },
    config: { get: jest.fn() },
    scheduledRidesQueue: {},
    reconciliationService: {},
    settingsService: { getNumber: jest.fn().mockResolvedValue(5000) },
    metricsService: {
      rideCompletionsTotal: { inc: jest.fn() },
      rideCancellationsTotal: { inc: jest.fn() },
    },
    googleMaps: {},
    candidateSearchService: { search: jest.fn() },
    driverRankingService: { rank: jest.fn() },
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
    deps.poolMatchingService as any,
    deps.featureFlagsService as any,
  );

  return { service, deps };
}

function fakeRide(overrides: Record<string, any> = {}) {
  return {
    id: 'ride-1',
    passengerId: 'passenger-1',
    driverId: 'driver-1',
    status: RideStatus.COMPLETED,
    totalFare: '1000.00',
    tipAmount: '0.00',
    paymentMethod: PaymentMethod.WALLET,
    driverRating: null,
    driverRatingComment: null,
    passengerRating: null,
    passengerRatingComment: null,
    verificationPin: '1234',
    isPinVerified: false,
    ...overrides,
  };
}

function buildWithRide(overrides: Record<string, any> = {}) {
  const ride = fakeRide(overrides.orderOverrides);
  const ridesRepo = {
    findOne: jest.fn().mockResolvedValue(ride),
    save: jest.fn(async (data: any) => {
      Object.assign(ride, data);
      return data;
    }),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  const { service, deps } = buildService({ ridesRepo, ...overrides });
  return { service, deps, ride };
}

describe('RidesService.addTip', () => {
  it('debits the passenger, credits the driver, and records the tip amount', async () => {
    const { service, deps, ride } = buildWithRide();

    const result = await service.addTip('ride-1', 'passenger-1', 500);

    expect(deps.walletsService.debit).toHaveBeenCalledWith(
      'wallet-1',
      500,
      expect.anything(),
      'ride-1',
      expect.any(String),
    );
    expect(deps.walletsService.credit).toHaveBeenCalledWith(
      'wallet-1',
      500,
      expect.anything(),
      'ride-1',
      expect.any(String),
    );
    expect(result.tipAmount).toBe('500.00');
    expect(ride.tipAmount).toBe('500.00');
  });

  it('rejects a non-positive amount before touching any wallet', async () => {
    const { service, deps } = buildWithRide();
    await expect(service.addTip('ride-1', 'passenger-1', 0)).rejects.toThrow(BadRequestException);
    await expect(service.addTip('ride-1', 'passenger-1', -5)).rejects.toThrow(BadRequestException);
    expect(deps.walletsService.debit).not.toHaveBeenCalled();
  });

  it('rejects someone who is not the passenger on the ride', async () => {
    const { service } = buildWithRide();
    await expect(service.addTip('ride-1', 'someone-else', 500)).rejects.toThrow(ForbiddenException);
  });

  it('rejects tipping before the ride is completed', async () => {
    const { service } = buildWithRide({ orderOverrides: { status: RideStatus.IN_PROGRESS } });
    await expect(service.addTip('ride-1', 'passenger-1', 500)).rejects.toThrow(
      'You can only tip after the trip is completed',
    );
  });

  it('rejects tipping a ride with no driver', async () => {
    const { service } = buildWithRide({ orderOverrides: { driverId: null } });
    await expect(service.addTip('ride-1', 'passenger-1', 500)).rejects.toThrow(
      'This ride has no driver to tip',
    );
  });

  it('rejects tipping the same ride twice', async () => {
    const { service } = buildWithRide({ orderOverrides: { tipAmount: '200.00' } });
    await expect(service.addTip('ride-1', 'passenger-1', 500)).rejects.toThrow(
      'You already tipped this trip',
    );
  });

  it('does not throw when the debit succeeds but the driver credit fails, and does not double-charge on retry', async () => {
    const { service, deps, ride } = buildWithRide({
      walletsService: {
        getByUserId: jest.fn().mockResolvedValue({ id: 'wallet-1' }),
        debit: jest.fn().mockResolvedValue(undefined),
        credit: jest.fn().mockRejectedValue(new Error('driver wallet not found')),
      },
    });

    const result = await service.addTip('ride-1', 'passenger-1', 500);

    expect(result.tipAmount).toBe('500.00'); // set despite the credit failure — this is what blocks a double-charge
    expect(deps.walletsService.debit).toHaveBeenCalledTimes(1);
    expect(deps.events.emit).toHaveBeenCalledWith(
      'tip_earnings.credit_failed',
      expect.objectContaining({ rideId: 'ride-1', driverId: 'driver-1', amount: 500 }),
    );

    // Simulate the client retrying after seeing the (now-absent) error —
    // the "already tipped" guard must now catch it instead of debiting again.
    deps.walletsService.debit.mockClear();
    await expect(service.addTip('ride-1', 'passenger-1', 500)).rejects.toThrow(
      'You already tipped this trip',
    );
    expect(deps.walletsService.debit).not.toHaveBeenCalled();
    void ride;
  });

  it('propagates the error and leaves the tip unset when the passenger debit itself fails (safe to retry)', async () => {
    const { service, deps, ride } = buildWithRide({
      walletsService: {
        getByUserId: jest.fn().mockResolvedValue({ id: 'wallet-1' }),
        debit: jest.fn().mockRejectedValue(new Error('Insufficient wallet balance')),
        credit: jest.fn(),
      },
    });

    await expect(service.addTip('ride-1', 'passenger-1', 500)).rejects.toThrow('Insufficient wallet balance');

    expect(ride.tipAmount).toBe('0.00');
    expect(deps.walletsService.credit).not.toHaveBeenCalled();
  });
});

describe('RidesService.rateDriver', () => {
  it('saves the rating and applies it to the driver profile', async () => {
    const { service, deps, ride } = buildWithRide({
      driversService: { findByUserId: jest.fn().mockResolvedValue({ id: 'profile-1', userId: 'driver-1' }) },
    });

    const result = await service.rateDriver('ride-1', 'passenger-1', { rating: 5, comment: 'Great ride' });

    expect(result.driverRating).toBe(5);
    expect(ride.driverRatingComment).toBe('Great ride');
    expect(deps.driversService.applyRating).toHaveBeenCalledWith('profile-1', 5);
  });

  it('rejects someone who is not the passenger', async () => {
    const { service } = buildWithRide();
    await expect(service.rateDriver('ride-1', 'someone-else', { rating: 5 })).rejects.toThrow(ForbiddenException);
  });

  it('rejects rating before the ride is completed', async () => {
    const { service } = buildWithRide({ orderOverrides: { status: RideStatus.IN_PROGRESS } });
    await expect(service.rateDriver('ride-1', 'passenger-1', { rating: 5 })).rejects.toThrow(
      'Can only rate a completed ride',
    );
  });

  it('rejects rating the same ride twice', async () => {
    const { service } = buildWithRide({ orderOverrides: { driverRating: 4 } });
    await expect(service.rateDriver('ride-1', 'passenger-1', { rating: 5 })).rejects.toThrow(
      'This ride has already been rated',
    );
  });

  it('rejects rating a ride with no driver', async () => {
    const { service } = buildWithRide({ orderOverrides: { driverId: null } });
    await expect(service.rateDriver('ride-1', 'passenger-1', { rating: 5 })).rejects.toThrow(
      'This ride has no driver to rate',
    );
  });
});

describe('RidesService.ratePassenger', () => {
  it('saves the rating and applies it to the passenger', async () => {
    const { service, deps, ride } = buildWithRide();

    const result = await service.ratePassenger('ride-1', 'driver-1', { rating: 4, comment: 'Punctual' });

    expect(result.passengerRating).toBe(4);
    expect(ride.passengerRatingComment).toBe('Punctual');
    expect(deps.usersService.applyRating).toHaveBeenCalledWith('passenger-1', 4);
  });

  it('rejects a driver who does not own the ride', async () => {
    const { service } = buildWithRide();
    await expect(service.ratePassenger('ride-1', 'someone-else', { rating: 4 })).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('rejects rating before the ride is completed', async () => {
    const { service } = buildWithRide({ orderOverrides: { status: RideStatus.IN_PROGRESS } });
    await expect(service.ratePassenger('ride-1', 'driver-1', { rating: 4 })).rejects.toThrow(
      'Can only rate a completed ride',
    );
  });

  it('rejects rating the same ride twice', async () => {
    const { service } = buildWithRide({ orderOverrides: { passengerRating: 3 } });
    await expect(service.ratePassenger('ride-1', 'driver-1', { rating: 4 })).rejects.toThrow(
      'This ride has already been rated',
    );
  });
});

describe('RidesService.verifyPin', () => {
  it('verifies a correct pin and marks it verified', async () => {
    const { service, ride } = buildWithRide({ orderOverrides: { status: RideStatus.IN_PROGRESS } });

    const result = await service.verifyPin('ride-1', 'driver-1', '1234');

    expect(result.verified).toBe(true);
    expect(ride.isPinVerified).toBe(true);
  });

  it('rejects an incorrect pin without marking it verified', async () => {
    const { service, ride } = buildWithRide({ orderOverrides: { status: RideStatus.IN_PROGRESS } });

    const result = await service.verifyPin('ride-1', 'driver-1', '9999');

    expect(result.verified).toBe(false);
    expect(ride.isPinVerified).toBe(false);
  });

  it('rejects a driver who is not on this ride', async () => {
    const { service } = buildWithRide();
    await expect(service.verifyPin('ride-1', 'someone-else', '1234')).rejects.toThrow(ForbiddenException);
  });

  it('does not write to the repo again once already verified', async () => {
    const { service, deps } = buildWithRide({ orderOverrides: { isPinVerified: true } });

    await service.verifyPin('ride-1', 'driver-1', '1234');

    expect(deps.ridesRepo.save).not.toHaveBeenCalled();
  });
});

describe('RidesService.forceStatusForAdmin', () => {
  it('sets the status and restores driver availability for a terminal status', async () => {
    const { service, deps, ride } = buildWithRide({ orderOverrides: { status: RideStatus.IN_PROGRESS } });

    const result = await service.forceStatusForAdmin('ride-1', RideStatus.CANCELLED);

    expect(result.status).toBe(RideStatus.CANCELLED);
    expect(deps.driversService.restoreAvailabilityAfterTrip).toHaveBeenCalledWith('driver-1');
    void ride;
  });

  it('does not touch driver availability for a non-terminal status', async () => {
    const { service, deps } = buildWithRide({ orderOverrides: { status: RideStatus.SEARCHING } });

    await service.forceStatusForAdmin('ride-1', RideStatus.ACCEPTED);

    expect(deps.driversService.restoreAvailabilityAfterTrip).not.toHaveBeenCalled();
  });

  it('does not blow up the whole call if restoring driver availability fails', async () => {
    const { service, deps } = buildWithRide({
      orderOverrides: { status: RideStatus.IN_PROGRESS },
      driversService: {
        restoreAvailabilityAfterTrip: jest.fn().mockRejectedValue(new Error('driver not found')),
      },
    });

    const result = await service.forceStatusForAdmin('ride-1', RideStatus.CANCELLED);
    expect(result.status).toBe(RideStatus.CANCELLED);
  });
});

describe('RidesService.deleteForAdmin', () => {
  it('deletes a non-completed ride', async () => {
    const { service, deps } = buildWithRide({ orderOverrides: { status: RideStatus.CANCELLED } });

    const result = await service.deleteForAdmin('ride-1');

    expect(result).toEqual({ deleted: true });
    expect(deps.ridesRepo.delete).toHaveBeenCalledWith('ride-1');
  });

  it('refuses to delete a completed ride, since it has real settled wallet transactions', async () => {
    const { service, deps } = buildWithRide({ orderOverrides: { status: RideStatus.COMPLETED } });

    await expect(service.deleteForAdmin('ride-1')).rejects.toThrow(BadRequestException);
    expect(deps.ridesRepo.delete).not.toHaveBeenCalled();
  });
});
