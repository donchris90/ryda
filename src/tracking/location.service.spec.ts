import { LocationService } from './location.service';

function build() {
  const historyRepo = { save: jest.fn(async (d: any) => d), create: jest.fn((d: any) => d) };
  const ridesRepo = { findOne: jest.fn().mockResolvedValue(null) };
  const deliveryOrdersRepo = { findOne: jest.fn().mockResolvedValue(null) };
  const trackingGateway = {
    broadcastDriverLocation: jest.fn(),
    broadcastDeliveryLocation: jest.fn(),
    broadcastAdminDriverLocation: jest.fn(),
  };

  const service = new LocationService(
    historyRepo as any,
    ridesRepo as any,
    deliveryOrdersRepo as any,
    trackingGateway as any,
  );

  return { service, ridesRepo, deliveryOrdersRepo, trackingGateway };
}

const PAYLOAD = { driverUserId: 'driver-1', lat: 6.52, lng: 3.37, at: new Date('2026-01-01T00:00:00Z') };

describe('LocationService.onDriverLocationUpdated() - admin live-map attribution', () => {
  it('attributes the broadcast to an active ride when the driver has one', async () => {
    const { service, ridesRepo, trackingGateway } = build();
    ridesRepo.findOne.mockResolvedValue({ id: 'ride-1' });

    await service.onDriverLocationUpdated(PAYLOAD);

    expect(trackingGateway.broadcastAdminDriverLocation).toHaveBeenCalledWith(
      expect.objectContaining({ driverId: 'driver-1', rideId: 'ride-1', deliveryId: null }),
    );
  });

  it('attributes the broadcast to an active delivery when the driver has one', async () => {
    const { service, deliveryOrdersRepo, trackingGateway } = build();
    deliveryOrdersRepo.findOne.mockResolvedValue({ id: 'delivery-1' });

    await service.onDriverLocationUpdated(PAYLOAD);

    expect(trackingGateway.broadcastAdminDriverLocation).toHaveBeenCalledWith(
      expect.objectContaining({ driverId: 'driver-1', rideId: null, deliveryId: 'delivery-1' }),
    );
  });

  it('still broadcasts with both null when the driver has neither an active ride nor delivery (idle-but-online)', async () => {
    const { service, trackingGateway } = build();

    await service.onDriverLocationUpdated(PAYLOAD);

    expect(trackingGateway.broadcastAdminDriverLocation).toHaveBeenCalledWith(
      expect.objectContaining({ driverId: 'driver-1', rideId: null, deliveryId: null }),
    );
  });

  it('forwards the delivery-room broadcast only when a delivery is active, independent of ride status', async () => {
    const { service, deliveryOrdersRepo, trackingGateway } = build();
    deliveryOrdersRepo.findOne.mockResolvedValue({ id: 'delivery-1' });

    await service.onDriverLocationUpdated(PAYLOAD);

    expect(trackingGateway.broadcastDeliveryLocation).toHaveBeenCalledWith(
      'delivery-1',
      expect.objectContaining({ lat: PAYLOAD.lat, lng: PAYLOAD.lng }),
    );
  });
});
