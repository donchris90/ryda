import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { RidesService } from './rides.service';

function fakeRide(overrides: Record<string, any> = {}) {
  return {
    id: 'ride-1',
    driverId: 'driver-1',
    verificationPin: '4321',
    isPinVerified: false,
    pinAttemptCount: 0,
    ...overrides,
  };
}

function buildService(overrides: Record<string, any> = {}) {
  const ridesRepo = {
    findOne: jest.fn(),
    save: jest.fn(async (r: any) => r),
    manager: { transaction: jest.fn(async (cb: any) => cb(overrides.manager ?? {})) },
    ...overrides.ridesRepo,
  };

  const deps = {
    ridesRepo,
    fareService: {},
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
    geofenceService: { isWithinServiceArea: jest.fn().mockResolvedValue(true), checkPoint: jest.fn().mockResolvedValue([]) },
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
    {} as any, // airportService (not exercised by this suite's scenarios)
    {} as any, // fraudService (not exercised by this suite's scenarios)
  );

  return { service, deps };
}

describe('RidesService.verifyPin()', () => {
  it('a correct PIN verifies successfully and is invalidated (cleared) after use', async () => {
    const { service, deps } = buildService();
    const ride = fakeRide();
    deps.ridesRepo.findOne.mockResolvedValue(ride);

    const result = await service.verifyPin('ride-1', 'driver-1', '4321');

    expect(result.verified).toBe(true);
    expect(deps.ridesRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ isPinVerified: true, verificationPin: null }),
    );
  });

  it('an incorrect PIN is rejected and increments the attempt count, without invalidating the real PIN', async () => {
    const { service, deps } = buildService();
    const ride = fakeRide();
    deps.ridesRepo.findOne.mockResolvedValue(ride);

    const result = await service.verifyPin('ride-1', 'driver-1', '0000');

    expect(result.verified).toBe(false);
    expect(deps.ridesRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ isPinVerified: false, verificationPin: '4321', pinAttemptCount: 1 }),
    );
  });

  it('rejects a second attempt after 5 wrong guesses - the actual rate limit, not just an incrementing counter nobody enforces', async () => {
    const { service, deps } = buildService();
    const ride = fakeRide({ pinAttemptCount: 5 });
    deps.ridesRepo.findOne.mockResolvedValue(ride);

    await expect(service.verifyPin('ride-1', 'driver-1', '0000')).rejects.toThrow(BadRequestException);
    expect(deps.ridesRepo.save).not.toHaveBeenCalled();
  });

  it('rejects re-verifying a PIN that was already successfully used', async () => {
    const { service, deps } = buildService();
    const ride = fakeRide({ isPinVerified: true, verificationPin: null });
    deps.ridesRepo.findOne.mockResolvedValue(ride);

    await expect(service.verifyPin('ride-1', 'driver-1', '4321')).rejects.toThrow(BadRequestException);
    expect(deps.ridesRepo.save).not.toHaveBeenCalled();
  });

  it('rejects a driver who is not actually assigned to this ride', async () => {
    const { service, deps } = buildService();
    const ride = fakeRide({ driverId: 'someone-else' });
    deps.ridesRepo.findOne.mockResolvedValue(ride);

    await expect(service.verifyPin('ride-1', 'driver-1', '4321')).rejects.toThrow(ForbiddenException);
  });
});
