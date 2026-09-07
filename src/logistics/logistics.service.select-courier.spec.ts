import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { LogisticsService } from './logistics.service';
import { DeliveryOrder, DeliveryStatus, DeliveryVehicleType, DeliveryCategory } from './entities/delivery-order.entity';
import { PaymentMethod } from '../common/enums/ride.enum';
import { VehicleCategory } from '../common/enums/vehicle.enum';

function fakeOrder(overrides: Partial<DeliveryOrder> = {}): DeliveryOrder {
  return {
    id: 'order-1',
    customerId: 'customer-1',
    driverId: null,
    vehicleId: null,
    category: DeliveryCategory.PARCEL,
    vehicleType: DeliveryVehicleType.CAR,
    status: DeliveryStatus.SEARCHING,
    pickupLat: 6.5244,
    pickupLng: 3.3792,
    pickupAddress: '1 Pickup St',
    dropoffLat: 6.44,
    dropoffLng: 3.42,
    dropoffAddress: '2 Dropoff St',
    totalFare: '2500.00',
    paymentMethod: PaymentMethod.CASH,
    ...overrides,
  } as DeliveryOrder;
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
    level: 'standard',
    ...overrides,
  };
}

function buildService(overrides: Record<string, any> = {}) {
  const ordersRepo = {
    create: jest.fn((data) => data),
    save: jest.fn(async (data) => ({ id: 'order-1', ...data })),
    findOne: jest.fn(),
    find: jest.fn().mockResolvedValue([]),
    manager: { transaction: jest.fn(async (cb: any) => cb(overrides.manager ?? {})) },
    ...overrides.ordersRepo,
  };

  const deps = {
    ordersRepo,
    config: { get: jest.fn() },
    driversService: { findByUserId: jest.fn(), ...overrides.driversService },
    vehiclesService: { findById: jest.fn(), ...overrides.vehiclesService },
    walletsService: {},
    commissionService: {},
    corporateService: {},
    fleetService: {},
    usersService: {},
    paymentsService: {},
    reconciliationService: {},
    settingsService: { getNumber: jest.fn().mockResolvedValue(0) },
    vehicleTypesService: { getByType: jest.fn(), ...overrides.vehicleTypesService },
    candidateSearchService: { search: jest.fn(), ...overrides.candidateSearchService },
    driverRankingService: { rank: jest.fn(), ...overrides.driverRankingService },
    events: { emit: jest.fn(), ...overrides.events },
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

describe('LogisticsService.selectCourier()', () => {
  it(
    'sends the courier a real delivery.requested offer instead of auto-accepting on their behalf - the actual bug: ' +
      'a customer selecting a courier previously called acceptDelivery() directly, so the courier never saw or ' +
      'confirmed anything at all before the order showed as already assigned to them',
    async () => {
      const { service, deps } = buildService();
      deps.ordersRepo.findOne.mockResolvedValue(fakeOrder({ status: DeliveryStatus.SEARCHING }));
      deps.candidateSearchService.search.mockResolvedValue({ candidates: [fakeCandidate({ driverUserId: 'driver-1' })] });

      const result = await service.selectCourier('order-1', 'customer-1', 'driver-1');

      expect(deps.events.emit).toHaveBeenCalledWith(
        'delivery.requested',
        expect.objectContaining({ driverUserIds: ['driver-1'], deliveryId: 'order-1' }),
      );
      // Still SEARCHING - not assigned/accepted on the courier's behalf.
      // acceptDelivery() (called separately, by the courier themselves
      // tapping Accept) is what actually transitions it.
      expect(result.status).toBe(DeliveryStatus.SEARCHING);
      // The field the app actually depends on to distinguish "nobody
      // invited yet" from "someone specific was invited and we're
      // waiting on them" (see the migration/entity comment) - without
      // this, delivery/[id].tsx's own redirect logic can't tell the
      // two SEARCHING sub-states apart.
      expect(result.pendingCourierUserId).toBe('driver-1');
    },
  );

  it('does not call acceptDelivery (no driverId/vehicleId gets assigned as a side effect of selection alone)', async () => {
    const { service, deps } = buildService();
    deps.ordersRepo.findOne.mockResolvedValue(fakeOrder({ status: DeliveryStatus.SEARCHING }));
    deps.candidateSearchService.search.mockResolvedValue({ candidates: [fakeCandidate({ driverUserId: 'driver-1' })] });

    await service.selectCourier('order-1', 'customer-1', 'driver-1');

    // acceptDelivery's own preflight checks (driver approval, vehicle
    // status, etc.) are never touched by selection alone.
    expect(deps.driversService.findByUserId).not.toHaveBeenCalled();
    expect(deps.vehiclesService.findById).not.toHaveBeenCalled();
  });

  it('rejects selecting a courier who is no longer eligible, without emitting an offer to them', async () => {
    const { service, deps } = buildService();
    deps.ordersRepo.findOne.mockResolvedValue(fakeOrder({ status: DeliveryStatus.SEARCHING }));
    deps.candidateSearchService.search.mockResolvedValue({ candidates: [fakeCandidate({ driverUserId: 'someone-else' })] });

    await expect(service.selectCourier('order-1', 'customer-1', 'driver-1')).rejects.toThrow(BadRequestException);
    expect(deps.events.emit).not.toHaveBeenCalled();
  });

  it("rejects selecting a courier for another customer's delivery", async () => {
    const { service, deps } = buildService();
    deps.ordersRepo.findOne.mockResolvedValue(fakeOrder({ customerId: 'someone-else' }));

    await expect(service.selectCourier('order-1', 'customer-1', 'driver-1')).rejects.toThrow(ForbiddenException);
  });

  it('rejects selecting a courier once the order has moved past SEARCHING/REQUESTED', async () => {
    const { service, deps } = buildService();
    deps.ordersRepo.findOne.mockResolvedValue(fakeOrder({ status: DeliveryStatus.PICKED_UP }));

    await expect(service.selectCourier('order-1', 'customer-1', 'driver-1')).rejects.toThrow(BadRequestException);
  });
});
