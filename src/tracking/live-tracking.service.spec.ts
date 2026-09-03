import { LiveTrackingService } from './live-tracking.service';
import { DeliveryStatus } from '../logistics/entities/delivery-order.entity';

function build() {
  const ridesRepo = { find: jest.fn().mockResolvedValue([]) };
  const deliveryOrdersRepo = { find: jest.fn().mockResolvedValue([]) };
  const driverProfilesRepo = { find: jest.fn().mockResolvedValue([]) };
  const usersRepo = { find: jest.fn().mockResolvedValue([]) };

  const service = new LiveTrackingService(
    ridesRepo as any,
    deliveryOrdersRepo as any,
    driverProfilesRepo as any,
    usersRepo as any,
  );

  return { service, ridesRepo, deliveryOrdersRepo, driverProfilesRepo, usersRepo };
}

function fakeDelivery(overrides: Partial<any> = {}) {
  return {
    id: 'delivery-1',
    status: DeliveryStatus.IN_TRANSIT,
    driverId: 'driver-1',
    customerId: 'customer-1',
    pickupLat: 6.5,
    pickupLng: 3.3,
    pickupAddress: '1 Pickup St',
    dropoffLat: 6.6,
    dropoffLng: 3.4,
    dropoffAddress: '2 Dropoff Ave',
    dropoffContactName: 'Recipient Name',
    ...overrides,
  };
}

describe('LiveTrackingService.getLiveDeliveriesSnapshot()', () => {
  it('includes the courier\'s last-known position and both parties\' names for an active delivery', async () => {
    const { service, deliveryOrdersRepo, driverProfilesRepo, usersRepo } = build();
    deliveryOrdersRepo.find.mockResolvedValue([fakeDelivery()]);
    driverProfilesRepo.find.mockResolvedValue([
      { userId: 'driver-1', currentLat: 6.55, currentLng: 3.35, locationUpdatedAt: new Date('2026-01-01'), city: 'Lagos' },
    ]);
    usersRepo.find.mockResolvedValue([
      { id: 'driver-1', firstName: 'Dave', lastName: 'Driver' },
      { id: 'customer-1', firstName: 'Cara', lastName: 'Customer' },
    ]);

    const { deliveries } = await service.getLiveDeliveriesSnapshot();

    expect(deliveries).toEqual([
      expect.objectContaining({
        deliveryId: 'delivery-1',
        status: DeliveryStatus.IN_TRANSIT,
        driverId: 'driver-1',
        driverName: 'Dave Driver',
        customerId: 'customer-1',
        customerName: 'Cara Customer',
        dropoffContactName: 'Recipient Name',
        driverLat: 6.55,
        driverLng: 3.35,
      }),
    ]);
  });

  it('reports null driver position/name for a delivery not yet assigned to a courier', async () => {
    const { service, deliveryOrdersRepo } = build();
    deliveryOrdersRepo.find.mockResolvedValue([
      fakeDelivery({ status: DeliveryStatus.ACCEPTED, driverId: null }),
    ]);

    const { deliveries } = await service.getLiveDeliveriesSnapshot();

    expect(deliveries[0]).toEqual(
      expect.objectContaining({ driverId: null, driverName: null, driverLat: null, driverLng: null }),
    );
  });

  it('filters by the courier\'s registered city, the same proxy rides use', async () => {
    const { service, deliveryOrdersRepo, driverProfilesRepo, usersRepo } = build();
    deliveryOrdersRepo.find.mockResolvedValue([
      fakeDelivery({ id: 'd-lagos', driverId: 'driver-lagos' }),
      fakeDelivery({ id: 'd-abuja', driverId: 'driver-abuja' }),
    ]);
    driverProfilesRepo.find.mockResolvedValue([
      { userId: 'driver-lagos', currentLat: 6.5, currentLng: 3.3, locationUpdatedAt: null, city: 'Lagos' },
      { userId: 'driver-abuja', currentLat: 9.0, currentLng: 7.4, locationUpdatedAt: null, city: 'Abuja' },
    ]);
    usersRepo.find.mockResolvedValue([]);

    const { deliveries } = await service.getLiveDeliveriesSnapshot('Lagos');

    expect(deliveries.map((d) => d.deliveryId)).toEqual(['d-lagos']);
  });

  it('returns no deliveries when nothing is currently active', async () => {
    const { service, deliveryOrdersRepo } = build();
    deliveryOrdersRepo.find.mockResolvedValue([]);

    const { deliveries } = await service.getLiveDeliveriesSnapshot();

    expect(deliveries).toEqual([]);
  });
});
