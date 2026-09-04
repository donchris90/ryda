import { BadRequestException } from '@nestjs/common';
import { RidesService } from './rides.service';
import { PaymentMethod, RideCategory } from '../common/enums/ride.enum';

function buildService(overrides: Record<string, any> = {}) {
  const ridesRepo = {
    create: jest.fn((d: any) => d),
    save: jest.fn(async (d: any) => ({ id: 'ride-1', ...d })),
  };
  const pricingService = { calculateSurge: jest.fn().mockResolvedValue({ multiplier: 1 }) };
  const fareService = {
    estimate: jest.fn().mockResolvedValue({
      baseFare: 300, distanceFare: 500, timeFare: 100, surgeMultiplier: 1,
      nightMultiplierApplied: 1, airportFee: 0, tollFare: 0, discount: 0, totalFare: 900,
      usedRealRouting: false,
    }),
  };
  const passengersService = { assertNotBlacklisted: jest.fn().mockResolvedValue(undefined) };
  const events = { emit: jest.fn() };
  const metricsService = { rideRequestsTotal: { inc: jest.fn() } };
  const geofenceService = { isWithinServiceArea: jest.fn().mockResolvedValue(true), checkPoint: jest.fn().mockResolvedValue([]), ...overrides.geofenceService };

  const service = new RidesService(
    ridesRepo as any,
    fareService as any,
    {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
    passengersService as any,
    {} as any, {} as any, {} as any, {} as any,
    pricingService as any,
    events as any,
    { get: jest.fn() } as any,
    {} as any, {} as any, {} as any,
    metricsService as any,
    {} as any, {} as any, {} as any,
    geofenceService as any,
    {} as any, // airportService (not exercised by this suite's scenarios)
    {} as any, // fraudService (not exercised by this suite's scenarios)
    {} as any, // poolMatchingService (not exercised by this suite)
    {} as any, // featureFlagsService (not exercised by this suite)
  );

  return { service, geofenceService, ridesRepo, fareService };
}

const DTO = {
  category: RideCategory.ECONOMY,
  pickupLat: 6.6,
  pickupLng: 3.35,
  pickupAddress: 'A',
  dropoffLat: 6.5,
  dropoffLng: 3.3,
  dropoffAddress: 'B',
  paymentMethod: PaymentMethod.WALLET,
} as any;

describe('RidesService.requestRide() - service area enforcement', () => {
  it('rejects a ride whose pickup is outside the configured service area, before any fare is calculated', async () => {
    const { service, geofenceService, fareService } = buildService();
    geofenceService.isWithinServiceArea.mockImplementation(async (lat: number) => lat !== DTO.pickupLat);

    await expect(service.requestRide('passenger-1', DTO)).rejects.toThrow(BadRequestException);
    await expect(service.requestRide('passenger-1', DTO)).rejects.toThrow(/pickup location is outside/);
    expect(fareService.estimate).not.toHaveBeenCalled();
  });

  it('rejects a ride whose destination is outside the configured service area', async () => {
    const { service, geofenceService } = buildService();
    geofenceService.isWithinServiceArea.mockImplementation(async (lat: number) => lat !== DTO.dropoffLat);

    await expect(service.requestRide('passenger-1', DTO)).rejects.toThrow(/destination is outside/);
  });

  it('allows a ride when both pickup and destination are genuinely within the service area', async () => {
    const { service } = buildService();

    await expect(service.requestRide('passenger-1', DTO)).resolves.toBeDefined();
  });

  it('allows every ride when no service areas are configured at all (open-by-default, matching GeofenceService.isWithinServiceArea() itself)', async () => {
    const { service, geofenceService } = buildService();
    geofenceService.isWithinServiceArea.mockResolvedValue(true); // GeofenceService already returns true when nothing's configured

    await expect(service.requestRide('passenger-1', DTO)).resolves.toBeDefined();
  });
});

describe('RidesService.requestRide() - restricted-zone pickup warning (pickup intelligence)', () => {
  it('sets a restrictedZoneWarning, naming the zone, when the pickup falls inside a RESTRICTED-type geofence', async () => {
    const { service, geofenceService, ridesRepo } = buildService();
    geofenceService.checkPoint.mockResolvedValue([
      { type: 'restricted', name: 'Secure Compound - Gate 4' },
      { type: 'surge_zone', name: 'Unrelated surge area' }, // confirms only RESTRICTED matters, not every geofence hit
    ]);

    await service.requestRide('passenger-1', DTO);

    expect(ridesRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ restrictedZoneWarning: expect.stringContaining('Secure Compound - Gate 4') }),
    );
  });

  it('leaves restrictedZoneWarning null for an ordinary pickup with no restricted-zone hit', async () => {
    const { service, geofenceService, ridesRepo } = buildService();
    geofenceService.checkPoint.mockResolvedValue([]);

    await service.requestRide('passenger-1', DTO);

    expect(ridesRepo.create).toHaveBeenCalledWith(expect.objectContaining({ restrictedZoneWarning: null }));
  });

  it('never blocks the ride over a restricted-zone hit - informational only, unlike the service-area check', async () => {
    const { service, geofenceService } = buildService();
    geofenceService.checkPoint.mockResolvedValue([{ type: 'restricted', name: 'Zone X' }]);

    await expect(service.requestRide('passenger-1', DTO)).resolves.toBeDefined();
  });
});
