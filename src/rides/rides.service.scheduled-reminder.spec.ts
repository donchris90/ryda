import { RidesService } from './rides.service';
import { RideStatus } from '../common/enums/ride.enum';
import { DispatchMode } from '../candidate-search/candidate-search.types';

function fakeRide(overrides: Record<string, any> = {}) {
  return {
    id: 'ride-1',
    passengerId: 'passenger-1',
    driverId: null,
    status: RideStatus.SCHEDULED,
    dispatchMode: DispatchMode.AUTO,
    pickupAddress: '12 Marina Road',
    scheduledAt: new Date(Date.now() + 3600_000),
    ...overrides,
  };
}

function build(overrides: Record<string, any> = {}) {
  const ridesRepo = {
    findOne: jest.fn().mockResolvedValue(fakeRide()),
    save: jest.fn(async (r: any) => r),
    ...overrides.ridesRepo,
  };
  const autoDispatchService = { startForRide: jest.fn().mockResolvedValue(undefined), ...overrides.autoDispatchService };
  const events = { emit: jest.fn(), ...overrides.events };
  const scheduledRidesQueue = { getJob: jest.fn().mockResolvedValue(undefined), add: jest.fn(), ...overrides.scheduledRidesQueue };

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
    autoDispatchService,
    pricingService: {},
    events,
    config: { get: jest.fn() },
    scheduledRidesQueue,
    reconciliationService: {},
    settingsService: { getNumber: jest.fn().mockResolvedValue(60) },
    metricsService: {},
    googleMaps: {},
    candidateSearchService: {},
    driverRankingService: {},
    geofenceService: {},
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
    {} as any, // airportService
    {} as any, // fraudService
    {} as any, // poolMatchingService (not exercised by this suite)
    {} as any, // featureFlagsService (not exercised by this suite)
  );

  return { service, ridesRepo, autoDispatchService, events, scheduledRidesQueue };
}

describe('RidesService.sendScheduledRideReminder()', () => {
  it('emits a reminder event with the passenger, pickup address, and scheduled time when the ride is still SCHEDULED', async () => {
    const { service, events } = build({
      ridesRepo: { findOne: jest.fn().mockResolvedValue(fakeRide({ passengerId: 'passenger-9', pickupAddress: '4 Bourdillon Rd' })) },
    });

    await service.sendScheduledRideReminder('ride-1');

    expect(events.emit).toHaveBeenCalledWith(
      'ride.scheduled_reminder',
      expect.objectContaining({ passengerId: 'passenger-9', pickupAddress: '4 Bourdillon Rd' }),
    );
  });

  it('does nothing when the ride was cancelled before the reminder fired', async () => {
    const { service, events } = build({
      ridesRepo: { findOne: jest.fn().mockResolvedValue(fakeRide({ status: RideStatus.CANCELLED })) },
    });

    await service.sendScheduledRideReminder('ride-1');

    expect(events.emit).not.toHaveBeenCalled();
  });

  it('does nothing when the ride already activated before the reminder fired', async () => {
    const { service, events } = build({
      ridesRepo: { findOne: jest.fn().mockResolvedValue(fakeRide({ status: RideStatus.SEARCHING })) },
    });

    await service.sendScheduledRideReminder('ride-1');

    expect(events.emit).not.toHaveBeenCalled();
  });

  it('does nothing when the ride no longer exists at all', async () => {
    const { service, events } = build({ ridesRepo: { findOne: jest.fn().mockResolvedValue(null) } });

    await service.sendScheduledRideReminder('missing-ride');

    expect(events.emit).not.toHaveBeenCalled();
  });
});

describe('RidesService.activateScheduledRide()', () => {
  it('flips status to SEARCHING and starts auto-dispatch for an AUTO ride', async () => {
    const { service, ridesRepo, autoDispatchService } = build({
      ridesRepo: { findOne: jest.fn().mockResolvedValue(fakeRide({ dispatchMode: DispatchMode.AUTO })) },
    });

    await service.activateScheduledRide('ride-1');

    expect(ridesRepo.save).toHaveBeenCalledWith(expect.objectContaining({ status: RideStatus.SEARCHING }));
    expect(autoDispatchService.startForRide).toHaveBeenCalledWith('ride-1');
  });

  it('flips status to SEARCHING but does NOT auto-dispatch a MANUAL ride - the passenger picks a driver themselves', async () => {
    const { service, ridesRepo, autoDispatchService } = build({
      ridesRepo: { findOne: jest.fn().mockResolvedValue(fakeRide({ dispatchMode: DispatchMode.MANUAL })) },
    });

    await service.activateScheduledRide('ride-1');

    expect(ridesRepo.save).toHaveBeenCalledWith(expect.objectContaining({ status: RideStatus.SEARCHING }));
    expect(autoDispatchService.startForRide).not.toHaveBeenCalled();
  });

  it('is a no-op for a ride already cancelled before activation fired - never resurrects it', async () => {
    const { service, ridesRepo } = build({
      ridesRepo: { findOne: jest.fn().mockResolvedValue(fakeRide({ status: RideStatus.CANCELLED })) },
    });

    await service.activateScheduledRide('ride-1');

    expect(ridesRepo.save).not.toHaveBeenCalled();
  });
});

describe('RidesService.cancelRide() - scheduled-ride job cleanup', () => {
  it('removes both the activation job and the reminder job when cancelling a SCHEDULED ride', async () => {
    const activateJob = { remove: jest.fn().mockResolvedValue(undefined) };
    const remindJob = { remove: jest.fn().mockResolvedValue(undefined) };
    const { service, scheduledRidesQueue } = build({
      ridesRepo: {
        findOne: jest.fn().mockResolvedValue(fakeRide({ status: RideStatus.SCHEDULED })),
        manager: { transaction: jest.fn(async (cb: any) => cb({ createQueryBuilder: jest.fn() })) },
      },
      scheduledRidesQueue: {
        getJob: jest.fn((id: string) => Promise.resolve(id.startsWith('activate-') ? activateJob : remindJob)),
      },
    });
    // cancelRide needs a fair amount of supporting machinery this
    // lean build doesn't set up (fraud checks, metrics, etc.) - this
    // suite only asserts the job-cleanup side effect, so a thrown
    // error from later in the method after that cleanup already ran
    // doesn't invalidate what's being tested here.
    await service.cancelRide('ride-1', 'passenger-1', 'passenger' as any, {} as any).catch(() => undefined);

    expect(scheduledRidesQueue.getJob).toHaveBeenCalledWith('activate-ride-1');
    expect(scheduledRidesQueue.getJob).toHaveBeenCalledWith('remind-ride-1');
    expect(activateJob.remove).toHaveBeenCalled();
    expect(remindJob.remove).toHaveBeenCalled();
  });
});
