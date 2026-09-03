import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AirportService } from './airport.service';
import { AirportQueueStatus } from './entities/airport-queue-entry.entity';
import { RideCategory } from '../common/enums/ride.enum';
import { VehicleCategory, VehicleStatus } from '../common/enums/vehicle.enum';

function build() {
  const airportsRepo = {
    save: jest.fn(async (d: any) => ({ id: 'airport-1', ...d })),
    create: jest.fn((d: any) => d),
    find: jest.fn(),
    findOne: jest.fn(),
  };
  const zonesRepo = {
    save: jest.fn(async (d: any) => ({ id: 'zone-1', ...d })),
    create: jest.fn((d: any) => d),
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn(),
  };
  const queueRepo = {
    save: jest.fn(async (d: any) => ({ id: 'queue-1', ...d })),
    create: jest.fn((d: any) => d),
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    update: jest.fn(),
  };
  const driverProfilesRepo = { findOne: jest.fn().mockResolvedValue(null) };
  const vehiclesRepo = { findOne: jest.fn().mockResolvedValue(null) };

  const service = new AirportService(
    airportsRepo as any,
    zonesRepo as any,
    queueRepo as any,
    driverProfilesRepo as any,
    vehiclesRepo as any,
  );

  return { service, airportsRepo, zonesRepo, queueRepo, driverProfilesRepo, vehiclesRepo };
}

describe('AirportService.isVehicleCategoryEligible()', () => {
  it('allows every category when the airport has no restriction configured', () => {
    const { service } = build();
    const airport = { eligibleRideCategories: null } as any;

    expect(service.isVehicleCategoryEligible(airport, RideCategory.ECONOMY)).toBe(true);
    expect(service.isVehicleCategoryEligible(airport, RideCategory.COMFORT)).toBe(true);
  });

  it('allows every category when the restriction list is an empty array', () => {
    const { service } = build();
    const airport = { eligibleRideCategories: [] } as any;

    expect(service.isVehicleCategoryEligible(airport, RideCategory.ECONOMY)).toBe(true);
  });

  it('only allows categories on the configured list', () => {
    const { service } = build();
    const airport = { eligibleRideCategories: [RideCategory.COMFORT] } as any;

    expect(service.isVehicleCategoryEligible(airport, RideCategory.COMFORT)).toBe(true);
    expect(service.isVehicleCategoryEligible(airport, RideCategory.ECONOMY)).toBe(false);
  });
});

describe('AirportService zones', () => {
  it('rejects creating a zone under a nonexistent airport', async () => {
    const { service, airportsRepo } = build();
    airportsRepo.findOne.mockResolvedValue(null);

    await expect(
      service.createZone('missing-airport', { name: 'Terminal 1', lat: 1, lng: 1 }),
    ).rejects.toThrow(NotFoundException);
  });

  it('finds the nearest zone within its own radius, not just the airport-wide geofence', async () => {
    const { service, zonesRepo } = build();
    zonesRepo.find.mockResolvedValue([
      { id: 'z1', name: 'Terminal 1 Arrivals', lat: 6.5774, lng: 3.3211, radiusKm: 0.3, isActive: true },
      { id: 'z2', name: 'Terminal 2 Departures', lat: 6.5800, lng: 3.3250, radiusKm: 0.3, isActive: true },
    ]);

    // A point essentially on top of z1's coordinates
    const nearest = await service.findContainingZone('airport-1', 6.5774, 3.3211);

    expect(nearest?.id).toBe('z1');
  });

  it('returns null when the point is outside every zone radius', async () => {
    const { service, zonesRepo } = build();
    zonesRepo.find.mockResolvedValue([
      { id: 'z1', name: 'Terminal 1 Arrivals', lat: 6.5774, lng: 3.3211, radiusKm: 0.3, isActive: true },
    ]);

    // Roughly 5-6km away - well outside a 0.3km curbside radius
    const nearest = await service.findContainingZone('airport-1', 6.63, 3.38);

    expect(nearest).toBeNull();
  });
});

describe('AirportService.joinQueue() - vehicle category capture', () => {
  it('captures the category of the driver\'s active, ACTIVE-status vehicle', async () => {
    const { service, airportsRepo, driverProfilesRepo, vehiclesRepo, queueRepo } = build();
    airportsRepo.findOne.mockResolvedValue({ id: 'airport-1' });
    driverProfilesRepo.findOne.mockResolvedValue({ activeVehicleId: 'vehicle-1' });
    vehiclesRepo.findOne.mockResolvedValue({ id: 'vehicle-1', status: VehicleStatus.ACTIVE, category: VehicleCategory.CAR });

    await service.joinQueue('airport-1', 'driver-1');

    expect(queueRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ vehicleCategory: VehicleCategory.CAR }),
    );
  });

  it('stores null when the driver has no active vehicle, without failing the join', async () => {
    const { service, airportsRepo, driverProfilesRepo, queueRepo } = build();
    airportsRepo.findOne.mockResolvedValue({ id: 'airport-1' });
    driverProfilesRepo.findOne.mockResolvedValue({ activeVehicleId: null });

    await service.joinQueue('airport-1', 'driver-1');

    expect(queueRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ vehicleCategory: null }),
    );
  });

  it('stores null when the active vehicle exists but is not ACTIVE status', async () => {
    const { service, airportsRepo, driverProfilesRepo, vehiclesRepo, queueRepo } = build();
    airportsRepo.findOne.mockResolvedValue({ id: 'airport-1' });
    driverProfilesRepo.findOne.mockResolvedValue({ activeVehicleId: 'vehicle-1' });
    vehiclesRepo.findOne.mockResolvedValue({ id: 'vehicle-1', status: VehicleStatus.MAINTENANCE, category: VehicleCategory.CAR });

    await service.joinQueue('airport-1', 'driver-1');

    expect(queueRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ vehicleCategory: null }),
    );
  });

  it('rejects a duplicate join while already waiting', async () => {
    const { service, airportsRepo, queueRepo } = build();
    airportsRepo.findOne.mockResolvedValue({ id: 'airport-1' });
    queueRepo.findOne.mockResolvedValue({ id: 'existing-entry' });

    await expect(service.joinQueue('airport-1', 'driver-1')).rejects.toThrow(BadRequestException);
  });
});

describe('AirportService.dispatchNext() - category-aware queue priority', () => {
  function entry(id: string, joinedAt: string, vehicleCategory: string | null) {
    return { id, airportId: 'airport-1', driverUserId: id, status: AirportQueueStatus.WAITING, joinedAt: new Date(joinedAt), dispatchedAt: null, vehicleCategory };
  }

  it('dispatches the front of the queue (plain FIFO) when no category is required', async () => {
    const { service, queueRepo } = build();
    queueRepo.find.mockResolvedValue([
      entry('d1', '2026-01-01T10:00:00Z', VehicleCategory.MOTORCYCLE),
      entry('d2', '2026-01-01T10:01:00Z', VehicleCategory.CAR),
    ]);

    const dispatched = await service.dispatchNext('airport-1');

    expect(dispatched?.driverUserId).toBe('d1');
  });

  it('skips a non-matching first-in-queue driver in favour of a later matching one, without dropping the skipped driver from the queue', async () => {
    const { service, queueRepo } = build();
    queueRepo.find.mockResolvedValue([
      entry('d1', '2026-01-01T10:00:00Z', VehicleCategory.MOTORCYCLE), // arrived first, wrong category
      entry('d2', '2026-01-01T10:01:00Z', VehicleCategory.CAR), // arrived second, matches
    ]);

    const dispatched = await service.dispatchNext('airport-1', RideCategory.ECONOMY);

    expect(dispatched?.driverUserId).toBe('d2');
    // d1 was never removed/updated - it stays WAITING for a ride that does fit it.
    expect(queueRepo.save).toHaveBeenCalledTimes(1);
    expect(queueRepo.save).toHaveBeenCalledWith(expect.objectContaining({ driverUserId: 'd2' }));
  });

  it('returns null (not a mismatched driver) when nothing in the queue matches the required category', async () => {
    const { service, queueRepo } = build();
    queueRepo.find.mockResolvedValue([
      entry('d1', '2026-01-01T10:00:00Z', VehicleCategory.MOTORCYCLE),
      entry('d2', '2026-01-01T10:01:00Z', VehicleCategory.TRICYCLE),
    ]);

    const dispatched = await service.dispatchNext('airport-1', RideCategory.ECONOMY);

    expect(dispatched).toBeNull();
    expect(queueRepo.save).not.toHaveBeenCalled();
  });

  it('treats a queue entry with no captured category (joined before this feature, or no active vehicle) as a non-match, not a wildcard', async () => {
    const { service, queueRepo } = build();
    queueRepo.find.mockResolvedValue([entry('d1', '2026-01-01T10:00:00Z', null)]);

    const dispatched = await service.dispatchNext('airport-1', RideCategory.ECONOMY);

    expect(dispatched).toBeNull();
  });

  it('returns null when the queue is empty', async () => {
    const { service, queueRepo } = build();
    queueRepo.find.mockResolvedValue([]);

    expect(await service.dispatchNext('airport-1')).toBeNull();
    expect(await service.dispatchNext('airport-1', RideCategory.ECONOMY)).toBeNull();
  });
});
