import { RidesService } from './rides.service';
import { RideStatus, PaymentMethod } from '../common/enums/ride.enum';
import { BadRequestException, ForbiddenException } from '@nestjs/common';

/**
 * Mirrors buildService() in rides.service.manual-dispatch.spec.ts —
 * every collaborator stubbed and spread from overrides so a test only
 * has to override what it actually cares about. Kept as its own copy
 * (matching the existing convention of cancel-race/manual-dispatch each
 * having their own) rather than importing from another .spec.ts file.
 */
function buildService(overrides: Record<string, any> = {}) {
  const ridesRepo = {
    findOne: jest.fn(),
    save: jest.fn(async (data: any) => data),
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
      recordTripOutcome: jest.fn(),
      restoreAvailabilityAfterTrip: jest.fn(),
      ...overrides.driversService,
    },
    vehiclesService: { findById: jest.fn(), ...overrides.vehiclesService },
    walletsService: {
      getByUserId: jest.fn().mockResolvedValue({ id: 'wallet-1' }),
      debit: jest.fn().mockResolvedValue(undefined),
      credit: jest.fn().mockResolvedValue(undefined),
      ...overrides.walletsService,
    },
    commissionService: {
      resolveCommissionPercent: jest.fn().mockResolvedValue(15),
      ...overrides.commissionService,
    },
    usersService: {
      findByIds: jest.fn().mockResolvedValue([]),
      findById: jest.fn().mockResolvedValue({
        id: 'passenger-1',
        email: 'passenger@example.com',
      }),
      ...overrides.usersService,
    },
    paymentsService: {
      chargeSavedCard: jest.fn(),
      initBankTransfer: jest.fn(),
      ...overrides.paymentsService,
    },
    corporateService: {
      getAccountForEmployee: jest.fn(),
      debitForRide: jest.fn(),
      flagRideForApprovalIfNeeded: jest.fn().mockResolvedValue(undefined),
      ...overrides.corporateService,
    },
    passengersService: {
      recordTripOutcome: jest.fn(),
      ...overrides.passengersService,
    },
    promotionsService: {
      settleCashbackForRide: jest.fn(),
      grantReferralBonusIfEligible: jest.fn(),
      ...overrides.promotionsService,
    },
    fleetService: {
      creditForRideEarning: jest.fn(),
      debitFleetCommission: jest.fn(),
      ...overrides.fleetService,
    },
    dispatchService: {},
    autoDispatchService: {},
    pricingService: {},
    events: { emit: jest.fn(), ...overrides.events },
    config: { get: jest.fn() },
    scheduledRidesQueue: {},
    reconciliationService: {
      getOutstandingBalance: jest.fn().mockResolvedValue({ totalOwed: '0' }),
      recordDebt: jest.fn(),
      ...overrides.reconciliationService,
    },
    settingsService: { getNumber: jest.fn().mockResolvedValue(5000) },
    metricsService: {
      autoDispatchOffersAcceptedTotal: { inc: jest.fn() },
      dispatchLatencySeconds: { startTimer: jest.fn(() => jest.fn()) },
      rideCompletionsTotal: { inc: jest.fn() },
      ...overrides.metricsService,
    },
    googleMaps: {},
    candidateSearchService: { search: jest.fn() },
    driverRankingService: { rank: jest.fn() },
    geofenceService: {},
    airportService: {},
    poolMatchingService: { requestPool: jest.fn(), propagateDriverAssignment: jest.fn().mockResolvedValue(undefined), onRideCancelledBeforeMatch: jest.fn().mockResolvedValue(undefined), unpoolRide: jest.fn().mockResolvedValue(undefined) },
    featureFlagsService: { isEnabled: jest.fn().mockResolvedValue(true) },
  };

  const service = new RidesService(
    deps.ridesRepo,
    deps.fareService as any,
    deps.driversService,
    deps.vehiclesService,
    deps.walletsService,
    deps.commissionService,
    deps.usersService,
    deps.paymentsService,
    deps.corporateService,
    deps.passengersService,
    deps.promotionsService,
    deps.fleetService,
    deps.dispatchService as any,
    deps.autoDispatchService as any,
    deps.pricingService as any,
    deps.events,
    deps.config as any,
    deps.scheduledRidesQueue as any,
    deps.reconciliationService,
    deps.settingsService as any,
    deps.metricsService,
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

function fakeDriverProfile(overrides: Record<string, any> = {}) {
  return {
    id: 'profile-1',
    userId: 'driver-1',
    activeVehicleId: null,
    commissionOverridePercent: '10', // set so tests don't need to also stub resolveCommissionPercent unless they override it away
    fleetCompanyId: null,
    level: 'standard',
    ...overrides,
  };
}

function fakeRide(overrides: Record<string, any> = {}) {
  return {
    id: 'ride-1',
    passengerId: 'passenger-1',
    driverId: 'driver-1',
    status: RideStatus.IN_PROGRESS,
    totalFare: '1000.00',
    paymentMethod: overrides.paymentMethod ?? PaymentMethod.WALLET,
    earningsSettled: false,
    commissionPercent: null,
    commissionAmount: null,
    driverEarnings: null,
    completedAt: null,
    ...overrides,
  };
}

function buildForCompleteRide(overrides: Record<string, any> = {}) {
  const ride = fakeRide(
    overrides.orderOverrides
      ? { ...overrides.orderOverrides }
      : { paymentMethod: overrides.paymentMethod },
  );
  if (overrides.paymentMethod) ride.paymentMethod = overrides.paymentMethod;

  const ridesRepo = {
    findOne: jest.fn().mockResolvedValue(ride),
    save: jest.fn(async (data: any) => {
      Object.assign(ride, data);
      return data;
    }),
  };

  const { service, deps } = buildService({
    ridesRepo,
    driversService: {
      findByUserId: jest
        .fn()
        .mockResolvedValue(fakeDriverProfile(overrides.driverProfile)),
      recordTripOutcome: jest.fn(),
      restoreAvailabilityAfterTrip: jest.fn(),
    },
    walletsService: overrides.walletsService,
    paymentsService: overrides.paymentsService,
    corporateService: overrides.corporateService,
    usersService: overrides.usersService,
    fleetService: overrides.fleetService,
    reconciliationService: overrides.reconciliationService,
    promotionsService: overrides.promotionsService,
    commissionService: overrides.commissionService,
  });

  return { service, deps, ride };
}

describe('RidesService.completeRide — guards', () => {
  it('rejects a driver who does not own the ride', async () => {
    const { service } = buildForCompleteRide({
      paymentMethod: PaymentMethod.WALLET,
    });
    await expect(
      service.completeRide('ride-1', 'someone-else'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects a ride that is not IN_PROGRESS', async () => {
    const { service } = buildForCompleteRide({
      paymentMethod: PaymentMethod.WALLET,
      orderOverrides: { status: RideStatus.SEARCHING },
    });
    await expect(service.completeRide('ride-1', 'driver-1')).rejects.toThrow(
      BadRequestException,
    );
  });
});

describe('RidesService.completeRide — WALLET payments', () => {
  it('debits the passenger, credits the driver, and marks the ride settled', async () => {
    const { service, deps, ride } = buildForCompleteRide({
      paymentMethod: PaymentMethod.WALLET,
    });

    const result = await service.completeRide('ride-1', 'driver-1');

    expect(result.status).toBe(RideStatus.COMPLETED);
    expect(deps.walletsService.debit).toHaveBeenCalledWith(
      'wallet-1',
      1000,
      expect.anything(),
      'ride-1',
      expect.any(String),
    );
    expect(deps.walletsService.credit).toHaveBeenCalled();
    expect(ride.earningsSettled).toBe(true);
    expect(deps.events.emit).toHaveBeenCalledWith(
      'ride.completed',
      expect.objectContaining({
        passengerId: 'passenger-1',
        driverId: 'driver-1',
      }),
    );
    expect(deps.metricsService.rideCompletionsTotal.inc).toHaveBeenCalledWith({
      paymentMethod: PaymentMethod.WALLET,
    });
  });

  it('reverts the ride to IN_PROGRESS and rethrows when the passenger charge itself fails', async () => {
    const { service, deps, ride } = buildForCompleteRide({
      paymentMethod: PaymentMethod.WALLET,
      walletsService: {
        debit: jest
          .fn()
          .mockRejectedValue(new Error('Insufficient wallet balance')),
      },
    });

    await expect(service.completeRide('ride-1', 'driver-1')).rejects.toThrow(
      'Insufficient wallet balance',
    );

    expect(ride.status).toBe(RideStatus.IN_PROGRESS);
    expect(ride.completedAt).toBeNull();
    expect(ride.commissionAmount).toBeNull();
    expect(deps.walletsService.credit).not.toHaveBeenCalled();
    expect(deps.driversService.recordTripOutcome).not.toHaveBeenCalled();
  });

  /**
   * Same money-safety property covered for the delivery side in
   * logistics.service.spec.ts: once the passenger has actually been
   * charged, a downstream failure must not revert the ride (which would
   * let a retry charge them a second time) or rethrow — it should be
   * left settled-but-uncredited for ops follow-up.
   */
  it('does NOT revert or rethrow when the passenger was charged but crediting the driver fails', async () => {
    const { service, deps, ride } = buildForCompleteRide({
      paymentMethod: PaymentMethod.WALLET,
      walletsService: {
        debit: jest.fn().mockResolvedValue(undefined),
        credit: jest
          .fn()
          .mockRejectedValue(new Error('driver wallet not found')),
      },
    });

    const result = await service.completeRide('ride-1', 'driver-1');

    expect(result.status).toBe(RideStatus.COMPLETED);
    expect(deps.walletsService.debit).toHaveBeenCalledTimes(1); // charged exactly once
    expect(ride.earningsSettled).toBeFalsy(); // left unsettled for ops follow-up
    expect(deps.events.emit).toHaveBeenCalledWith(
      'driver_earnings.credit_failed',
      expect.objectContaining({ rideId: 'ride-1', driverId: 'driver-1' }),
    );
    // Trip-outcome/promotions side effects still run — the ride did complete.
    expect(deps.driversService.recordTripOutcome).toHaveBeenCalled();
  });

  it('routes driver earnings to the fleet wallet, not a personal one, when the driver belongs to a fleet', async () => {
    const { service, deps } = buildForCompleteRide({
      paymentMethod: PaymentMethod.WALLET,
      driverProfile: { fleetCompanyId: 'fleet-1' },
    });

    await service.completeRide('ride-1', 'driver-1');

    expect(deps.fleetService.creditForRideEarning).toHaveBeenCalledWith(
      'fleet-1',
      expect.any(Number),
      'ride-1',
    );
    expect(deps.walletsService.credit).not.toHaveBeenCalled();
  });
});

describe('RidesService.completeRide — CARD payments', () => {
  it('charges the saved card and credits the driver on success', async () => {
    const { service, deps } = buildForCompleteRide({
      paymentMethod: PaymentMethod.CARD,
      paymentsService: {
        chargeSavedCard: jest.fn().mockResolvedValue({ status: 'success' }),
      },
    });

    const result = await service.completeRide('ride-1', 'driver-1');

    expect(result.status).toBe(RideStatus.COMPLETED);
    expect(deps.paymentsService.chargeSavedCard).toHaveBeenCalledWith(
      'ride-1',
      'passenger-1',
      'passenger@example.com',
      1000,
    );
    expect(deps.walletsService.credit).toHaveBeenCalled();
  });

  it('reverts the ride and does not credit the driver when the card charge is declined', async () => {
    const { service, deps, ride } = buildForCompleteRide({
      paymentMethod: PaymentMethod.CARD,
      paymentsService: {
        chargeSavedCard: jest.fn().mockResolvedValue({
          status: 'failed',
          failureReason: 'Card declined',
        }),
      },
    });

    await expect(service.completeRide('ride-1', 'driver-1')).rejects.toThrow(
      'Card declined',
    );

    expect(ride.status).toBe(RideStatus.IN_PROGRESS);
    expect(deps.walletsService.credit).not.toHaveBeenCalled();
    expect(deps.events.emit).toHaveBeenCalledWith(
      'payment.failed',
      expect.objectContaining({ userId: 'passenger-1' }),
    );
  });

  it('reverts without attempting a charge when the passenger has no email on file', async () => {
    const { service, deps, ride } = buildForCompleteRide({
      paymentMethod: PaymentMethod.CARD,
      usersService: {
        findById: jest
          .fn()
          .mockResolvedValue({ id: 'passenger-1', email: null }),
      },
    });

    await expect(service.completeRide('ride-1', 'driver-1')).rejects.toThrow(
      'Add an email to your account before paying by card',
    );

    expect(ride.status).toBe(RideStatus.IN_PROGRESS);
    expect(deps.paymentsService.chargeSavedCard).not.toHaveBeenCalled();
  });

  it('does not double-charge the card once the driver-credit step fails', async () => {
    const { service, deps } = buildForCompleteRide({
      paymentMethod: PaymentMethod.CARD,
      paymentsService: {
        chargeSavedCard: jest.fn().mockResolvedValue({ status: 'success' }),
      },
      walletsService: {
        credit: jest
          .fn()
          .mockRejectedValue(new Error('driver wallet not found')),
      },
    });

    const result = await service.completeRide('ride-1', 'driver-1');

    expect(result.status).toBe(RideStatus.COMPLETED);
    expect(deps.paymentsService.chargeSavedCard).toHaveBeenCalledTimes(1);
    expect(deps.events.emit).toHaveBeenCalledWith(
      'driver_earnings.credit_failed',
      expect.objectContaining({ rideId: 'ride-1' }),
    );
  });
});

describe('RidesService.completeRide — CORPORATE payments', () => {
  it('debits the linked corporate account and credits the driver', async () => {
    const { service, deps } = buildForCompleteRide({
      paymentMethod: PaymentMethod.CORPORATE,
      corporateService: {
        getAccountForEmployee: jest.fn().mockResolvedValue({ id: 'account-1' }),
        debitForRide: jest.fn().mockResolvedValue(undefined),
      },
    });

    const result = await service.completeRide('ride-1', 'driver-1');

    expect(result.status).toBe(RideStatus.COMPLETED);
    expect(deps.corporateService.debitForRide).toHaveBeenCalledWith(
      'account-1',
      1000,
      'ride-1',
      'passenger-1',
    );
    expect(deps.walletsService.credit).toHaveBeenCalled();
  });

  it('reverts when the passenger has no linked corporate account', async () => {
    const { service, deps, ride } = buildForCompleteRide({
      paymentMethod: PaymentMethod.CORPORATE,
      corporateService: {
        getAccountForEmployee: jest.fn().mockResolvedValue(null),
      },
    });

    await expect(service.completeRide('ride-1', 'driver-1')).rejects.toThrow(
      'Passenger is not linked to a corporate account',
    );
    expect(ride.status).toBe(RideStatus.IN_PROGRESS);
    expect(deps.corporateService.debitForRide).not.toHaveBeenCalled();
  });

  it('reverts when the corporate debit itself fails, without crediting the driver', async () => {
    const { service, deps, ride } = buildForCompleteRide({
      paymentMethod: PaymentMethod.CORPORATE,
      corporateService: {
        getAccountForEmployee: jest.fn().mockResolvedValue({ id: 'account-1' }),
        debitForRide: jest
          .fn()
          .mockRejectedValue(new Error('Corporate account over limit')),
      },
    });

    await expect(service.completeRide('ride-1', 'driver-1')).rejects.toThrow(
      'Corporate account over limit',
    );
    expect(ride.status).toBe(RideStatus.IN_PROGRESS);
    expect(deps.walletsService.credit).not.toHaveBeenCalled();
  });
});

describe('RidesService.completeRide — BANK_TRANSFER payments', () => {
  it('initiates the transfer but leaves the ride unsettled — the webhook settles it later', async () => {
    const { service, deps, ride } = buildForCompleteRide({
      paymentMethod: PaymentMethod.BANK_TRANSFER,
      paymentsService: {
        initBankTransfer: jest.fn().mockResolvedValue(undefined),
      },
    });

    const result = await service.completeRide('ride-1', 'driver-1');

    expect(result.status).toBe(RideStatus.COMPLETED);
    expect(deps.paymentsService.initBankTransfer).toHaveBeenCalledWith(
      'ride-1',
      'passenger-1',
      'passenger@example.com',
      1000,
    );
    // Not settled synchronously — handlePaymentConfirmed() does this once the webhook fires.
    expect(deps.walletsService.credit).not.toHaveBeenCalled();
    expect(ride.earningsSettled).toBe(false);
  });

  it('reverts without initiating a transfer when the passenger has no email on file', async () => {
    const { service, deps, ride } = buildForCompleteRide({
      paymentMethod: PaymentMethod.BANK_TRANSFER,
      usersService: {
        findById: jest
          .fn()
          .mockResolvedValue({ id: 'passenger-1', email: null }),
      },
    });

    await expect(service.completeRide('ride-1', 'driver-1')).rejects.toThrow(
      'Add an email to your account before paying by bank transfer',
    );
    expect(ride.status).toBe(RideStatus.IN_PROGRESS);
    expect(deps.paymentsService.initBankTransfer).not.toHaveBeenCalled();
  });
});

describe('RidesService.completeRide — CASH payments', () => {
  it('non-fleet driver: debits the commission from the driver wallet and settles immediately', async () => {
    const { service, deps, ride } = buildForCompleteRide({
      paymentMethod: PaymentMethod.CASH,
    });

    const result = await service.completeRide('ride-1', 'driver-1');

    expect(result.status).toBe(RideStatus.COMPLETED);
    expect(deps.walletsService.debit).toHaveBeenCalledWith(
      'wallet-1',
      expect.any(Number),
      expect.anything(),
      'ride-1',
      expect.any(String),
    );
    expect(ride.earningsSettled).toBe(true);
  });

  /**
   * Unlike WALLET/CARD/CORPORATE, a commission-collection failure on a
   * cash trip does NOT revert the ride — the driver already collected
   * the fare in physical cash, so there's nothing to safely "undo".
   * Instead it becomes a tracked debt for later reconciliation and the
   * trip still completes.
   */
  it('non-fleet driver: still completes and records a debt when the commission debit fails', async () => {
    const { service, deps, ride } = buildForCompleteRide({
      paymentMethod: PaymentMethod.CASH,
      walletsService: {
        debit: jest
          .fn()
          .mockRejectedValue(new Error('Insufficient wallet balance')),
      },
    });

    const result = await service.completeRide('ride-1', 'driver-1');

    expect(result.status).toBe(RideStatus.COMPLETED);
    expect(ride.earningsSettled).toBe(true);
    expect(deps.reconciliationService.recordDebt).toHaveBeenCalledWith(
      'driver-1',
      null,
      'ride-1',
      expect.any(Number),
    );
  });

  it('fleet driver: debits the fleet wallet for commission instead of a personal wallet', async () => {
    const { service, deps } = buildForCompleteRide({
      paymentMethod: PaymentMethod.CASH,
      driverProfile: { fleetCompanyId: 'fleet-1' },
      fleetService: {
        debitFleetCommission: jest.fn().mockResolvedValue(undefined),
      },
    });

    await service.completeRide('ride-1', 'driver-1');

    expect(deps.fleetService.debitFleetCommission).toHaveBeenCalledWith(
      'fleet-1',
      expect.any(Number),
      'ride-1',
    );
    expect(deps.walletsService.debit).not.toHaveBeenCalled();
  });

  it('fleet driver: records the debt against the fleet, not the driver, when the fleet debit fails', async () => {
    const { service, deps, ride } = buildForCompleteRide({
      paymentMethod: PaymentMethod.CASH,
      driverProfile: { fleetCompanyId: 'fleet-1' },
      fleetService: {
        debitFleetCommission: jest
          .fn()
          .mockRejectedValue(new Error('Fleet wallet frozen')),
      },
    });

    const result = await service.completeRide('ride-1', 'driver-1');

    expect(result.status).toBe(RideStatus.COMPLETED);
    expect(ride.earningsSettled).toBe(true);
    expect(deps.reconciliationService.recordDebt).toHaveBeenCalledWith(
      null,
      'fleet-1',
      'ride-1',
      expect.any(Number),
    );
  });
});

describe('RidesService.completeRide — commission and post-completion side effects', () => {
  it('uses the driver-specific commission override instead of resolveCommissionPercent when one is set', async () => {
    const { service, deps, ride } = buildForCompleteRide({
      paymentMethod: PaymentMethod.WALLET,
      driverProfile: { commissionOverridePercent: '12.5' },
    });

    await service.completeRide('ride-1', 'driver-1');

    expect(
      deps.commissionService.resolveCommissionPercent,
    ).not.toHaveBeenCalled();
    expect(ride.commissionPercent).toBe('12.50');
  });

  it('falls back to resolveCommissionPercent when no override is set', async () => {
    const { service, deps, ride } = buildForCompleteRide({
      paymentMethod: PaymentMethod.WALLET,
      driverProfile: { commissionOverridePercent: null },
      commissionService: {
        resolveCommissionPercent: jest.fn().mockResolvedValue(20),
      },
    });

    await service.completeRide('ride-1', 'driver-1');

    expect(deps.commissionService.resolveCommissionPercent).toHaveBeenCalled();
    expect(ride.commissionPercent).toBe('20.00');
  });

  /**
   * Regression coverage for the fix documented directly above the call
   * in rides.service.ts: grantReferralBonusIfEligible must run for both
   * the passenger AND the driver side, since driver-to-driver referrals
   * are honored on the referee's first completed trip too.
   */
  it('grants referral bonuses for both the passenger and the driver', async () => {
    const { service, deps } = buildForCompleteRide({
      paymentMethod: PaymentMethod.WALLET,
    });

    await service.completeRide('ride-1', 'driver-1');

    expect(
      deps.promotionsService.grantReferralBonusIfEligible,
    ).toHaveBeenCalledWith('passenger-1');
    expect(
      deps.promotionsService.grantReferralBonusIfEligible,
    ).toHaveBeenCalledWith('driver-1');
  });

  it('records trip outcomes and restores driver availability after a successful completion', async () => {
    const { service, deps } = buildForCompleteRide({
      paymentMethod: PaymentMethod.WALLET,
    });

    await service.completeRide('ride-1', 'driver-1');

    expect(deps.driversService.recordTripOutcome).toHaveBeenCalledWith(
      'profile-1',
      'completed',
    );
    expect(
      deps.driversService.restoreAvailabilityAfterTrip,
    ).toHaveBeenCalledWith('driver-1');
    expect(deps.passengersService.recordTripOutcome).toHaveBeenCalledWith(
      'passenger-1',
      'completed',
      1000,
    );
    expect(deps.promotionsService.settleCashbackForRide).toHaveBeenCalledWith(
      'ride-1',
      'passenger-1',
    );
  });
});

describe('RidesService.handlePaymentConfirmed — bank_transfer settlement webhook', () => {
  function buildForWebhook(overrides: Record<string, any> = {}) {
    const ride = fakeRide({
      paymentMethod: PaymentMethod.BANK_TRANSFER,
      status: RideStatus.COMPLETED,
      earningsSettled: false,
      driverEarnings: '850.00',
      commissionPercent: '15.00',
      ...overrides.orderOverrides,
    });

    const ridesRepo = {
      findOne: jest.fn().mockResolvedValue(ride),
      save: jest.fn(async (data: any) => {
        Object.assign(ride, data);
        return data;
      }),
    };

    const { service, deps } = buildService({
      ridesRepo,
      driversService: {
        findByUserId: jest
          .fn()
          .mockResolvedValue(fakeDriverProfile(overrides.driverProfile)),
      },
      walletsService: overrides.walletsService,
      fleetService: overrides.fleetService,
    });

    return { service, deps, ride };
  }

  it('credits the driver once the transfer is confirmed', async () => {
    const { service, deps, ride } = buildForWebhook();

    await service.handlePaymentConfirmed({
      rideId: 'ride-1',
      paymentRecordId: 'pay-1',
    });

    expect(deps.walletsService.credit).toHaveBeenCalledWith(
      'wallet-1',
      850,
      expect.anything(),
      'ride-1',
      expect.any(String),
    );
    expect(ride.earningsSettled).toBe(true);
  });

  it('is a no-op (idempotent) once the ride is already settled', async () => {
    const { service, deps } = buildForWebhook({
      orderOverrides: { earningsSettled: true },
    });

    await service.handlePaymentConfirmed({
      rideId: 'ride-1',
      paymentRecordId: 'pay-1',
    });

    expect(deps.walletsService.credit).not.toHaveBeenCalled();
  });

  it('is a no-op for a ride that was never a bank_transfer payment', async () => {
    const { service, deps } = buildForWebhook({
      orderOverrides: { paymentMethod: PaymentMethod.WALLET },
    });

    await service.handlePaymentConfirmed({
      rideId: 'ride-1',
      paymentRecordId: 'pay-1',
    });

    expect(deps.walletsService.credit).not.toHaveBeenCalled();
  });

  it('is a no-op when the ride has no driverEarnings recorded yet', async () => {
    const { service, deps } = buildForWebhook({
      orderOverrides: { driverEarnings: null },
    });

    await service.handlePaymentConfirmed({
      rideId: 'ride-1',
      paymentRecordId: 'pay-1',
    });

    expect(deps.walletsService.credit).not.toHaveBeenCalled();
  });
});
