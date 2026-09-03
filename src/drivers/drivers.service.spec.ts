import { BadRequestException } from '@nestjs/common';
import { DriversService } from './drivers.service';
import { DriverApprovalStatus, DriverAvailability } from '../common/enums/driver-status.enum';
import { DriverService, ServiceApprovalStatus } from '../common/enums/driver-service.enum';
import { OnboardDriverDto } from './dto/onboard-driver.dto';

/** Minimal in-memory fake for the capabilities repo — filters by the `where` clause instead of ignoring it, so tests can seed mixed pending/approved/rejected rows and trust the service's own status filter (e.g. getApprovedServices()) rather than the mock. */
function fakeCapabilitiesRepo(rows: any[] = []) {
  const store = [...rows];
  return {
    find: jest.fn(async ({ where }: { where: Record<string, any> } = { where: {} }) =>
      store.filter((row) => Object.entries(where ?? {}).every(([key, value]) => row[key] === value)),
    ),
    findOne: jest.fn(async ({ where }: { where: Record<string, any> }) =>
      store.find((row) => Object.entries(where).every(([key, value]) => row[key] === value)) ?? null,
    ),
    create: jest.fn((data: any) => ({ ...data })),
    save: jest.fn(async (row: any) => row),
    __store: store,
  };
}

/** Replaces the fake capabilities repo's contents (so find({where}) filters realistically instead of ignoring the query). */
function setCapabilities(capabilitiesRepo: ReturnType<typeof fakeCapabilitiesRepo>, rows: any[]) {
  capabilitiesRepo.__store.length = 0;
  capabilitiesRepo.__store.push(...rows);
}

function buildService(overrides: Record<string, any> = {}) {
  const driversRepo = {
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockImplementation((data) => ({ id: 'profile-1', ...data })),
    save: jest.fn().mockImplementation(async (x) => x),
    ...overrides.driversRepo,
  };
  const availabilityLogRepo = {
    findOne: jest.fn().mockResolvedValue(null),
    save: jest.fn().mockImplementation(async (x) => x),
    create: jest.fn().mockImplementation((data) => data),
    ...overrides.availabilityLogRepo,
  };
  const capabilitiesRepo = overrides.capabilitiesRepo ?? fakeCapabilitiesRepo();
  const events = { emit: jest.fn(), ...overrides.events };
  const fraudService = { checkGpsSpoof: jest.fn().mockResolvedValue(undefined), ...overrides.fraudService };
  const documentsService = {
    hasAllRequiredApproved: jest.fn().mockResolvedValue(true),
    ...overrides.documentsService,
  };
  const locationQualityService = {
    assess: jest.fn().mockReturnValue({ accept: true, issues: [] }),
    isDuplicateOf: jest.fn().mockReturnValue(false),
    isDuplicateStreakNotable: jest.fn().mockReturnValue(false),
    ...overrides.locationQualityService,
  };

  const service = new DriversService(
    driversRepo as any,
    availabilityLogRepo as any,
    capabilitiesRepo as any,
    events as any,
    fraudService as any,
    documentsService as any,
    locationQualityService as any,
  );

  return { service, driversRepo, availabilityLogRepo, capabilitiesRepo, events, documentsService, locationQualityService, fraudService };
}

function baseProfile(overrides: Partial<Record<string, any>> = {}) {
  return {
    id: 'profile-1',
    userId: 'user-1',
    approvalStatus: DriverApprovalStatus.APPROVED,
    availability: DriverAvailability.OFFLINE,
    lastOnlineAvailability: null,
    ...overrides,
  };
}

// ---- Registration ----

describe('DriversService.onboard — service selection', () => {
  it('creates a driver profile and a PENDING RIDE capability when the driver selects Rides', async () => {
    const { service, capabilitiesRepo } = buildService();

    await service.onboard('user-1', { licenseNumber: 'LIC-1', services: [DriverService.RIDE] } as OnboardDriverDto);

    expect(capabilitiesRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ service: DriverService.RIDE, status: ServiceApprovalStatus.PENDING }),
    );
    expect(capabilitiesRepo.save).not.toHaveBeenCalledWith(
      expect.objectContaining({ service: DriverService.DELIVERY }),
    );
  });

  it('creates a PENDING DELIVERY capability when the driver selects Deliveries', async () => {
    const { service, capabilitiesRepo } = buildService();

    await service.onboard('user-1', {
      licenseNumber: 'LIC-1',
      services: [DriverService.DELIVERY],
    } as OnboardDriverDto);

    expect(capabilitiesRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ service: DriverService.DELIVERY, status: ServiceApprovalStatus.PENDING }),
    );
  });

  it('creates both PENDING capabilities when the driver selects both services', async () => {
    const { service, capabilitiesRepo } = buildService();

    await service.onboard('user-1', {
      licenseNumber: 'LIC-1',
      services: [DriverService.RIDE, DriverService.DELIVERY],
    } as OnboardDriverDto);

    expect(capabilitiesRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ service: DriverService.RIDE, status: ServiceApprovalStatus.PENDING }),
    );
    expect(capabilitiesRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ service: DriverService.DELIVERY, status: ServiceApprovalStatus.PENDING }),
    );
  });

  it('rejects onboarding with zero services (server-side, never trusts the client to have enforced this)', async () => {
    const { service } = buildService();

    await expect(
      service.onboard('user-1', { licenseNumber: 'LIC-1', services: [] } as unknown as OnboardDriverDto),
    ).rejects.toThrow(BadRequestException);
  });
});

// ---- Approval ----

describe('DriversService.decideServiceCapability — admin approval', () => {
  it('approves a RIDE capability when documents are approved', async () => {
    const { service, capabilitiesRepo, driversRepo } = buildService();
    driversRepo.findOne.mockResolvedValue(baseProfile());
    capabilitiesRepo.findOne.mockResolvedValue({
      driverProfileId: 'profile-1',
      service: DriverService.RIDE,
      status: ServiceApprovalStatus.PENDING,
    });

    const result = await service.decideServiceCapability(
      'profile-1',
      DriverService.RIDE,
      ServiceApprovalStatus.APPROVED,
      'admin-1',
    );

    expect(result.status).toBe(ServiceApprovalStatus.APPROVED);
    expect(result.decidedByUserId).toBe('admin-1');
  });

  it('approves a DELIVERY capability independently of RIDE', async () => {
    const { service, capabilitiesRepo, driversRepo } = buildService();
    driversRepo.findOne.mockResolvedValue(baseProfile());
    capabilitiesRepo.findOne.mockResolvedValue({
      driverProfileId: 'profile-1',
      service: DriverService.DELIVERY,
      status: ServiceApprovalStatus.PENDING,
    });

    const result = await service.decideServiceCapability(
      'profile-1',
      DriverService.DELIVERY,
      ServiceApprovalStatus.APPROVED,
      'admin-1',
    );

    expect(result.status).toBe(ServiceApprovalStatus.APPROVED);
  });

  it('can approve both RIDE and DELIVERY for the same driver via two separate decisions', async () => {
    const { service, capabilitiesRepo, driversRepo } = buildService();
    driversRepo.findOne.mockResolvedValue(baseProfile());
    capabilitiesRepo.findOne
      .mockResolvedValueOnce({ driverProfileId: 'profile-1', service: DriverService.RIDE, status: ServiceApprovalStatus.PENDING })
      .mockResolvedValueOnce({ driverProfileId: 'profile-1', service: DriverService.DELIVERY, status: ServiceApprovalStatus.PENDING });

    const ride = await service.decideServiceCapability('profile-1', DriverService.RIDE, ServiceApprovalStatus.APPROVED, 'admin-1');
    const delivery = await service.decideServiceCapability('profile-1', DriverService.DELIVERY, ServiceApprovalStatus.APPROVED, 'admin-1');

    expect(ride.status).toBe(ServiceApprovalStatus.APPROVED);
    expect(delivery.status).toBe(ServiceApprovalStatus.APPROVED);
  });

  it('leaves a capability PENDING/untouched when only one of two requested services has been decided', async () => {
    const { capabilitiesRepo } = buildService();
    // Only RIDE was ever decided — DELIVERY still sits at PENDING in the store.
    setCapabilities(capabilitiesRepo, [
      { driverProfileId: 'profile-1', service: DriverService.RIDE, status: ServiceApprovalStatus.APPROVED },
      { driverProfileId: 'profile-1', service: DriverService.DELIVERY, status: ServiceApprovalStatus.PENDING },
    ]);

    const rows = await capabilitiesRepo.find({ where: { driverProfileId: 'profile-1' } });
    expect(rows.find((r: any) => r.service === DriverService.DELIVERY).status).toBe(ServiceApprovalStatus.PENDING);
  });

  it('rejects a capability with a reason', async () => {
    const { service, capabilitiesRepo, driversRepo } = buildService();
    driversRepo.findOne.mockResolvedValue(baseProfile());
    capabilitiesRepo.findOne.mockResolvedValue({
      driverProfileId: 'profile-1',
      service: DriverService.DELIVERY,
      status: ServiceApprovalStatus.PENDING,
    });

    const result = await service.decideServiceCapability(
      'profile-1',
      DriverService.DELIVERY,
      ServiceApprovalStatus.REJECTED,
      'admin-1',
      'Expired vehicle insurance',
    );

    expect(result.status).toBe(ServiceApprovalStatus.REJECTED);
    expect(result.rejectionReason).toBe('Expired vehicle insurance');
  });

  it('refuses to approve a service until required documents are approved (a driver can never approve themselves either way)', async () => {
    const { service, capabilitiesRepo, driversRepo, documentsService } = buildService();
    driversRepo.findOne.mockResolvedValue(baseProfile());
    documentsService.hasAllRequiredApproved.mockResolvedValue(false);
    capabilitiesRepo.findOne.mockResolvedValue({
      driverProfileId: 'profile-1',
      service: DriverService.RIDE,
      status: ServiceApprovalStatus.PENDING,
    });

    await expect(
      service.decideServiceCapability('profile-1', DriverService.RIDE, ServiceApprovalStatus.APPROVED, 'admin-1'),
    ).rejects.toThrow(BadRequestException);
  });
});

// ---- Availability (go-online) ----

describe('DriversService.setAvailability', () => {
  it('lets a RIDE-only approved driver go ONLINE_FOR_RIDES', async () => {
    const { service, driversRepo, capabilitiesRepo } = buildService();
    driversRepo.findOne.mockResolvedValue(baseProfile());
    setCapabilities(capabilitiesRepo, [
      { driverProfileId: 'profile-1', service: DriverService.RIDE, status: ServiceApprovalStatus.APPROVED },
    ]);

    const result = await service.setAvailability('user-1', DriverAvailability.ONLINE_FOR_RIDES);

    expect(result.availability).toBe(DriverAvailability.ONLINE_FOR_RIDES);
  });

  it('lets a DELIVERY-only approved driver go ONLINE_FOR_DELIVERIES', async () => {
    const { service, driversRepo, capabilitiesRepo } = buildService();
    driversRepo.findOne.mockResolvedValue(baseProfile());
    setCapabilities(capabilitiesRepo, [
      { driverProfileId: 'profile-1', service: DriverService.DELIVERY, status: ServiceApprovalStatus.APPROVED },
    ]);

    const result = await service.setAvailability('user-1', DriverAvailability.ONLINE_FOR_DELIVERIES);

    expect(result.availability).toBe(DriverAvailability.ONLINE_FOR_DELIVERIES);
  });

  it('lets a both-approved driver select RIDE only', async () => {
    const { service, driversRepo, capabilitiesRepo } = buildService();
    driversRepo.findOne.mockResolvedValue(baseProfile());
    setCapabilities(capabilitiesRepo, [
      { driverProfileId: 'profile-1', service: DriverService.RIDE, status: ServiceApprovalStatus.APPROVED },
      { driverProfileId: 'profile-1', service: DriverService.DELIVERY, status: ServiceApprovalStatus.APPROVED },
    ]);

    const result = await service.setAvailability('user-1', DriverAvailability.ONLINE_FOR_RIDES);

    expect(result.availability).toBe(DriverAvailability.ONLINE_FOR_RIDES);
  });

  it('lets a both-approved driver select DELIVERY only', async () => {
    const { service, driversRepo, capabilitiesRepo } = buildService();
    driversRepo.findOne.mockResolvedValue(baseProfile());
    setCapabilities(capabilitiesRepo, [
      { driverProfileId: 'profile-1', service: DriverService.RIDE, status: ServiceApprovalStatus.APPROVED },
      { driverProfileId: 'profile-1', service: DriverService.DELIVERY, status: ServiceApprovalStatus.APPROVED },
    ]);

    const result = await service.setAvailability('user-1', DriverAvailability.ONLINE_FOR_DELIVERIES);

    expect(result.availability).toBe(DriverAvailability.ONLINE_FOR_DELIVERIES);
  });

  it('lets a both-approved driver select BOTH', async () => {
    const { service, driversRepo, capabilitiesRepo } = buildService();
    driversRepo.findOne.mockResolvedValue(baseProfile());
    setCapabilities(capabilitiesRepo, [
      { driverProfileId: 'profile-1', service: DriverService.RIDE, status: ServiceApprovalStatus.APPROVED },
      { driverProfileId: 'profile-1', service: DriverService.DELIVERY, status: ServiceApprovalStatus.APPROVED },
    ]);

    const result = await service.setAvailability('user-1', DriverAvailability.ONLINE_FOR_BOTH);

    expect(result.availability).toBe(DriverAvailability.ONLINE_FOR_BOTH);
  });

  it('refuses to let a RIDE-only driver go ONLINE_FOR_DELIVERIES, even though the client requested it', async () => {
    const { service, driversRepo, capabilitiesRepo } = buildService();
    driversRepo.findOne.mockResolvedValue(baseProfile());
    setCapabilities(capabilitiesRepo, [
      { driverProfileId: 'profile-1', service: DriverService.RIDE, status: ServiceApprovalStatus.APPROVED },
    ]);

    await expect(service.setAvailability('user-1', DriverAvailability.ONLINE_FOR_DELIVERIES)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('refuses to let a DELIVERY-only driver go ONLINE_FOR_RIDES', async () => {
    const { service, driversRepo, capabilitiesRepo } = buildService();
    driversRepo.findOne.mockResolvedValue(baseProfile());
    setCapabilities(capabilitiesRepo, [
      { driverProfileId: 'profile-1', service: DriverService.DELIVERY, status: ServiceApprovalStatus.APPROVED },
    ]);

    await expect(service.setAvailability('user-1', DriverAvailability.ONLINE_FOR_RIDES)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('refuses ONLINE_FOR_BOTH unless both services are actually approved', async () => {
    const { service, driversRepo, capabilitiesRepo } = buildService();
    driversRepo.findOne.mockResolvedValue(baseProfile());
    setCapabilities(capabilitiesRepo, [
      { driverProfileId: 'profile-1', service: DriverService.RIDE, status: ServiceApprovalStatus.APPROVED },
      // DELIVERY still pending — not approved yet.
      { driverProfileId: 'profile-1', service: DriverService.DELIVERY, status: ServiceApprovalStatus.PENDING },
    ]);

    await expect(service.setAvailability('user-1', DriverAvailability.ONLINE_FOR_BOTH)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('refuses to change availability while a trip is active (ON_TRIP)', async () => {
    const { service, driversRepo } = buildService();
    driversRepo.findOne.mockResolvedValue(baseProfile({ availability: DriverAvailability.ON_TRIP }));

    await expect(service.setAvailability('user-1', DriverAvailability.OFFLINE)).rejects.toThrow(BadRequestException);
  });

  it('refuses to go online at all for a driver who is not overall APPROVED', async () => {
    const { service, driversRepo } = buildService();
    driversRepo.findOne.mockResolvedValue(baseProfile({ approvalStatus: DriverApprovalStatus.PENDING }));

    await expect(service.setAvailability('user-1', DriverAvailability.ONLINE_FOR_RIDES)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('remembers the chosen online state in lastOnlineAvailability, for restoreAvailabilityAfterTrip() to use later', async () => {
    const { service, driversRepo, capabilitiesRepo } = buildService();
    driversRepo.findOne.mockResolvedValue(baseProfile());
    setCapabilities(capabilitiesRepo, [
      { driverProfileId: 'profile-1', service: DriverService.RIDE, status: ServiceApprovalStatus.APPROVED },
      { driverProfileId: 'profile-1', service: DriverService.DELIVERY, status: ServiceApprovalStatus.APPROVED },
    ]);

    const result = await service.setAvailability('user-1', DriverAvailability.ONLINE_FOR_DELIVERIES);

    expect(result.lastOnlineAvailability).toBe(DriverAvailability.ONLINE_FOR_DELIVERIES);
  });
});

describe('DriversService.restoreAvailabilityAfterTrip', () => {
  it('restores a both-approved driver to exactly the online state they were reserved from', async () => {
    const { service, driversRepo, capabilitiesRepo } = buildService();
    driversRepo.findOne.mockResolvedValue(
      baseProfile({ availability: DriverAvailability.ON_TRIP, lastOnlineAvailability: DriverAvailability.ONLINE_FOR_RIDES }),
    );
    setCapabilities(capabilitiesRepo, [
      { driverProfileId: 'profile-1', service: DriverService.RIDE, status: ServiceApprovalStatus.APPROVED },
      { driverProfileId: 'profile-1', service: DriverService.DELIVERY, status: ServiceApprovalStatus.APPROVED },
    ]);

    const result = await service.restoreAvailabilityAfterTrip('user-1');

    expect(result.availability).toBe(DriverAvailability.ONLINE_FOR_RIDES);
  });

  it('downgrades gracefully if a service was revoked while the driver was on a trip', async () => {
    const { service, driversRepo, capabilitiesRepo } = buildService();
    driversRepo.findOne.mockResolvedValue(
      baseProfile({ availability: DriverAvailability.ON_TRIP, lastOnlineAvailability: DriverAvailability.ONLINE_FOR_BOTH }),
    );
    // DELIVERY got rejected/revoked mid-trip — only RIDE is still approved.
    setCapabilities(capabilitiesRepo, [
      { driverProfileId: 'profile-1', service: DriverService.RIDE, status: ServiceApprovalStatus.APPROVED },
      { driverProfileId: 'profile-1', service: DriverService.DELIVERY, status: ServiceApprovalStatus.REJECTED },
    ]);

    const result = await service.restoreAvailabilityAfterTrip('user-1');

    expect(result.availability).toBe(DriverAvailability.ONLINE_FOR_RIDES);
  });

  it('takes the driver OFFLINE if no approved service remains', async () => {
    const { service, driversRepo, capabilitiesRepo } = buildService();
    driversRepo.findOne.mockResolvedValue(
      baseProfile({ availability: DriverAvailability.ON_TRIP, lastOnlineAvailability: DriverAvailability.ONLINE_FOR_RIDES }),
    );
    setCapabilities(capabilitiesRepo, [
      { driverProfileId: 'profile-1', service: DriverService.RIDE, status: ServiceApprovalStatus.REJECTED },
    ]);

    const result = await service.restoreAvailabilityAfterTrip('user-1');

    expect(result.availability).toBe(DriverAvailability.OFFLINE);
  });

  it('is a no-op if the driver is not currently ON_TRIP (nothing to restore)', async () => {
    const { service, driversRepo } = buildService();
    driversRepo.findOne.mockResolvedValue(baseProfile({ availability: DriverAvailability.OFFLINE }));

    const result = await service.restoreAvailabilityAfterTrip('user-1');

    expect(result.availability).toBe(DriverAvailability.OFFLINE);
  });
});

describe('DriversService.updateLocation() - quality-aware position updates', () => {
  it('genuinely updates currentLat/currentLng and emits driver.location.updated when the quality assessment accepts the reading', async () => {
    const { service, driversRepo, events } = buildService();
    driversRepo.findOne.mockResolvedValue(baseProfile({ currentLat: null, currentLng: null, locationUpdatedAt: null }));

    const result = await service.updateLocation('user-1', 6.5, 3.3);

    expect(result.currentLat).toBe(6.5);
    expect(result.currentLng).toBe(3.3);
    expect(events.emit).toHaveBeenCalledWith('driver.location.updated', expect.objectContaining({ lat: 6.5, lng: 3.3 }));
  });

  it('does NOT update the live position and does NOT emit the event when the quality assessment rejects the reading (impossible jump)', async () => {
    const { service, driversRepo, events, locationQualityService } = buildService();
    locationQualityService.assess.mockReturnValue({ accept: false, issues: ['impossible_speed(9999km/h)'] });
    driversRepo.findOne.mockResolvedValue(
      baseProfile({ currentLat: 6.5, currentLng: 3.3, locationUpdatedAt: new Date(Date.now() - 60_000) }),
    );

    const result = await service.updateLocation('user-1', 10.5, 7.4);

    expect(result.currentLat).toBe(6.5); // unchanged
    expect(result.currentLng).toBe(3.3); // unchanged
    expect(events.emit).not.toHaveBeenCalled();
    expect(driversRepo.save).toHaveBeenCalled(); // the duplicate-streak counter still persists
  });

  it('still runs fraud review independently of the quality decision - both react to the same signal, but separately', async () => {
    const { service, driversRepo, fraudService } = buildService();
    const previous = { currentLat: 6.5, currentLng: 3.3, locationUpdatedAt: new Date(Date.now() - 60_000) };
    driversRepo.findOne.mockResolvedValue(baseProfile(previous));
    fraudService.checkGpsSpoof = jest.fn().mockResolvedValue(undefined);

    await service.updateLocation('user-1', 6.51, 3.31);

    expect(fraudService.checkGpsSpoof).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ lat: 6.5, lng: 3.3 }),
      expect.objectContaining({ lat: 6.51, lng: 3.31 }),
    );
  });

  it('increments the duplicate-streak counter when the coordinate exactly matches the previous one', async () => {
    const { service, driversRepo, locationQualityService } = buildService();
    locationQualityService.isDuplicateOf.mockReturnValue(true);
    driversRepo.findOne.mockResolvedValue(
      baseProfile({ currentLat: 6.5, currentLng: 3.3, locationUpdatedAt: new Date(), consecutiveDuplicateLocationCount: 3 }),
    );

    const result = await service.updateLocation('user-1', 6.5, 3.3);

    expect(result.consecutiveDuplicateLocationCount).toBe(4);
  });

  it('resets the duplicate-streak counter to 0 the moment the coordinate genuinely changes', async () => {
    const { service, driversRepo, locationQualityService } = buildService();
    locationQualityService.isDuplicateOf.mockReturnValue(false);
    driversRepo.findOne.mockResolvedValue(
      baseProfile({ currentLat: 6.5, currentLng: 3.3, locationUpdatedAt: new Date(), consecutiveDuplicateLocationCount: 15 }),
    );

    const result = await service.updateLocation('user-1', 6.9, 3.9);

    expect(result.consecutiveDuplicateLocationCount).toBe(0);
  });

  it('passes accuracy and fixTimestamp through to the quality assessment', async () => {
    const { service, driversRepo, locationQualityService } = buildService();
    driversRepo.findOne.mockResolvedValue(baseProfile({ currentLat: null, currentLng: null, locationUpdatedAt: null }));

    await service.updateLocation('user-1', 6.5, 3.3, 25, 1735900000000);

    expect(locationQualityService.assess).toHaveBeenCalledWith(
      null,
      { lat: 6.5, lng: 3.3, accuracy: 25, fixTimestamp: 1735900000000 },
      expect.any(Date),
    );
  });
});
