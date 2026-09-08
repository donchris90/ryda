import { LogisticsService } from './logistics.service';
import { DeliveryCategory, DeliveryStatus, DeliveryVehicleType } from './entities/delivery-order.entity';
import { PaymentMethod } from '../common/enums/ride.enum';

function fakeOrder(overrides: Partial<any> = {}) {
  return {
    id: 'order-1',
    customerId: 'customer-1',
    status: DeliveryStatus.SEARCHING,
    category: DeliveryCategory.PARCEL,
    vehicleType: DeliveryVehicleType.CAR,
    pickupLat: 6.5244,
    pickupLng: 3.3792,
    pickupAddress: '1 Pickup St',
    dropoffLat: 6.44,
    dropoffLng: 3.42,
    dropoffAddress: '2 Dropoff St',
    totalFare: '2500.00',
    paymentMethod: PaymentMethod.CASH,
    ...overrides,
  };
}

function buildService(overrides: Record<string, any> = {}) {
  const ordersRepo = {
    create: jest.fn((d) => d),
    save: jest.fn(async (d) => ({ id: 'order-1', ...d })),
    findOne: jest.fn().mockResolvedValue(fakeOrder()),
    find: jest.fn().mockResolvedValue([]),
    manager: { transaction: jest.fn(async (cb: any) => cb(overrides.manager ?? {})) },
    ...overrides.ordersRepo,
  };

  const deps = {
    ordersRepo,
    config: { get: jest.fn() },
    driversService: { findByUserId: jest.fn().mockResolvedValue({ completedTrips: 0 }), ...overrides.driversService },
    vehiclesService: { findById: jest.fn().mockResolvedValue(null), ...overrides.vehiclesService },
    walletsService: {},
    commissionService: {},
    corporateService: {},
    fleetService: {},
    usersService: { findByIds: jest.fn().mockResolvedValue([]), ...overrides.usersService },
    paymentsService: {},
    reconciliationService: {},
    settingsService: { getNumber: jest.fn().mockResolvedValue(0) },
    vehicleTypesService: { getByType: jest.fn() },
    candidateSearchService: { search: jest.fn(), ...overrides.candidateSearchService },
    driverRankingService: { rank: jest.fn(), ...overrides.driverRankingService },
    events: { emit: jest.fn() },
    metrics: { courierDispatchNoDriverFoundTotal: { inc: jest.fn() } },
    geofenceService: { isWithinServiceArea: jest.fn().mockResolvedValue(true), checkPoint: jest.fn().mockResolvedValue([]) },
  };

  const service = new LogisticsService(
    deps.ordersRepo as any,
    deps.config as any,
    deps.driversService as any,
    deps.vehiclesService as any,
    deps.walletsService as any,
    deps.commissionService as any,
    deps.corporateService as any,
    deps.fleetService as any,
    deps.usersService as any,
    deps.paymentsService as any,
    deps.reconciliationService as any,
    deps.settingsService as any,
    deps.vehicleTypesService as any,
    deps.candidateSearchService as any,
    deps.driverRankingService as any,
    deps.events as any,
    deps.metrics as any,
    deps.geofenceService as any,
  );

  return { service, deps };
}

describe('LogisticsService.findSelectableCouriers() - profile parity with rides', () => {
  it('includes completedTrips from the driver profile, matching the ride equivalent', async () => {
    const { service } = buildService({
      candidateSearchService: {
        search: jest.fn().mockResolvedValue({ candidates: [{ driverUserId: 'driver-1', vehicleId: 'vehicle-1' }] }),
      },
      driverRankingService: {
        rank: jest.fn().mockResolvedValue({
          ranked: [{ driverUserId: 'driver-1', vehicleId: 'vehicle-1', rating: 4.9, etaMinutes: 5, distanceKm: 1.2, vehicleCategory: 'car' }],
        }),
      },
      usersService: { findByIds: jest.fn().mockResolvedValue([{ id: 'driver-1', firstName: 'Tunde', profilePhotoUrl: null }]) },
      driversService: { findByUserId: jest.fn().mockResolvedValue({ completedTrips: 88 }) },
      vehiclesService: {
        findById: jest.fn().mockResolvedValue({
          id: 'vehicle-1',
          category: 'car',
          make: 'Honda',
          model: 'Civic',
          color: 'Blue',
          plateNumber: 'XYZ-999',
          photoUrl: 'https://example.com/v.jpg',
        }),
      },
    });

    const result = await service.findSelectableCouriers('order-1', 'customer-1');

    expect(result).toEqual([
      {
        id: 'driver-1',
        firstName: 'Tunde',
        profilePhoto: null,
        rating: 4.9,
        completedTrips: 88,
        vehicle: {
          category: 'car',
          make: 'Honda',
          model: 'Civic',
          color: 'Blue',
          plateNumber: 'XYZ-999',
          photoUrl: 'https://example.com/v.jpg',
        },
        etaMinutes: 5,
        distanceKm: 1.2,
      },
    ]);
  });

  it('defaults completedTrips to 0 when the driver profile lookup fails', async () => {
    const { service } = buildService({
      candidateSearchService: {
        search: jest.fn().mockResolvedValue({ candidates: [{ driverUserId: 'driver-1', vehicleId: 'vehicle-1' }] }),
      },
      driverRankingService: {
        rank: jest.fn().mockResolvedValue({
          ranked: [{ driverUserId: 'driver-1', vehicleId: 'vehicle-1', rating: 4.9, etaMinutes: 5, distanceKm: 1.2, vehicleCategory: 'car' }],
        }),
      },
      driversService: { findByUserId: jest.fn().mockRejectedValue(new Error('not found')) },
    });

    const result = await service.findSelectableCouriers('order-1', 'customer-1');

    expect(result[0].completedTrips).toBe(0);
  });
});
