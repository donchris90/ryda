import { BadRequestException } from '@nestjs/common';
import { DriversService } from './drivers.service';
import { DriverAvailability } from '../common/enums/driver-status.enum';

function buildService(overrides: Record<string, any> = {}) {
  const driversRepo = { ...overrides.driversRepo };
  const availabilityLogRepo = { ...overrides.availabilityLogRepo };
  const events = { emit: jest.fn(), ...overrides.events };
  const fraudService = { ...overrides.fraudService };
  const documentsService = { ...overrides.documentsService };

  const service = new DriversService(
    driversRepo as any,
    availabilityLogRepo as any,
    events as any,
    fraudService as any,
    documentsService as any,
  );

  return { service, events };
}

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
    findOne: jest.fn().mockResolvedValue(null), // no open shift-log row by default
    save: jest.fn().mockImplementation(async (x) => x),
    create: jest.fn().mockImplementation((_entity, data) => data),
    findOneOrFail: jest.fn().mockResolvedValue({
      userId: 'driver-1',
      id: 'profile-1',
      activeVehicleId: 'vehicle-1',
      availability: DriverAvailability.ON_TRIP,
    }),
    __queryBuilder: queryBuilder,
    ...overrides,
  };
}

describe('DriversService.reserveOnlineDriverForTrip', () => {
  it('atomically flips ONLINE -> ON_TRIP and returns the updated profile', async () => {
    const { service } = buildService();
    const manager = fakeManager();

    const result = await service.reserveOnlineDriverForTrip(manager as any, 'driver-1');

    expect(manager.__queryBuilder.set).toHaveBeenCalledWith({ availability: DriverAvailability.ON_TRIP });
    expect(manager.__queryBuilder.andWhere).toHaveBeenCalledWith('availability = :online', {
      online: DriverAvailability.ONLINE,
    });
    expect(result.userId).toBe('driver-1');
  });

  it('throws when the conditional UPDATE matches nothing — driver was not ONLINE (already reserved elsewhere)', async () => {
    const { service } = buildService();
    const manager = fakeManager();
    manager.__queryBuilder.execute.mockResolvedValue({ affected: 0 });

    await expect(service.reserveOnlineDriverForTrip(manager as any, 'driver-1')).rejects.toThrow(
      BadRequestException,
    );

    // Must not have touched shift-history bookkeeping if the reservation itself never happened.
    expect(manager.findOne).not.toHaveBeenCalled();
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('closes an open shift-log row and opens a new ON_TRIP one, scoped to the same manager (same transaction)', async () => {
    const { service } = buildService();
    const manager = fakeManager();
    const openRow = { id: 'log-1', endedAt: null };
    manager.findOne.mockResolvedValue(openRow);

    await service.reserveOnlineDriverForTrip(manager as any, 'driver-1');

    expect(manager.save).toHaveBeenCalledWith(expect.objectContaining({ id: 'log-1', endedAt: expect.any(Date) }));
    expect(manager.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ driverUserId: 'driver-1', status: DriverAvailability.ON_TRIP }),
    );
  });

  it('does not emit any event itself — that is emitReservedForTrip()’s job, called only after the outer transaction commits', async () => {
    const { service, events } = buildService();
    const manager = fakeManager();

    await service.reserveOnlineDriverForTrip(manager as any, 'driver-1');

    expect(events.emit).not.toHaveBeenCalled();
  });
});

describe('DriversService.emitReservedForTrip', () => {
  it('emits driver.availability.changed with an ONLINE -> ON_TRIP transition for the given profile', () => {
    const { service, events } = buildService();

    service.emitReservedForTrip({
      userId: 'driver-1',
      id: 'profile-1',
      activeVehicleId: 'vehicle-1',
      currentLat: 6.5,
      currentLng: 3.4,
      locationUpdatedAt: new Date('2026-01-01T00:00:00Z'),
    } as any);

    expect(events.emit).toHaveBeenCalledWith('driver.availability.changed', {
      driverUserId: 'driver-1',
      driverProfileId: 'profile-1',
      previous: DriverAvailability.ONLINE,
      availability: DriverAvailability.ON_TRIP,
      vehicleId: 'vehicle-1',
      lat: 6.5,
      lng: 3.4,
      locationUpdatedAt: new Date('2026-01-01T00:00:00Z'),
    });
  });
});
