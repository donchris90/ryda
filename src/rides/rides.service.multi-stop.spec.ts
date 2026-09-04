import { RidesService } from './rides.service';
import { PaymentMethod, RideCategory } from '../common/enums/ride.enum';

function buildService() {
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
  const geofenceService = { isWithinServiceArea: jest.fn().mockResolvedValue(true), checkPoint: jest.fn().mockResolvedValue([]) };

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

  return { service, ridesRepo, fareService };
}

const BASE_DTO = {
  category: RideCategory.ECONOMY,
  pickupLat: 6.6,
  pickupLng: 3.35,
  pickupAddress: 'A',
  dropoffLat: 6.5,
  dropoffLng: 3.3,
  dropoffAddress: 'B',
  paymentMethod: PaymentMethod.WALLET,
} as any;

const STOPS = [{ lat: 6.55, lng: 3.32, address: 'Stop 1' }];

describe('RidesService.requestRide() - multi-stop', () => {
  it('persists the given stops on the ride, in order', async () => {
    const { service, ridesRepo } = buildService();

    await service.requestRide('passenger-1', { ...BASE_DTO, stops: STOPS });

    expect(ridesRepo.create).toHaveBeenCalledWith(expect.objectContaining({ stops: STOPS }));
  });

  it('stores null (not undefined, not an empty array) when no stops are given', async () => {
    const { service, ridesRepo } = buildService();

    await service.requestRide('passenger-1', BASE_DTO);

    expect(ridesRepo.create).toHaveBeenCalledWith(expect.objectContaining({ stops: null }));
  });

  it('passes the stops through to fare estimation, not just persisting them decoratively', async () => {
    const { service, fareService } = buildService();

    await service.requestRide('passenger-1', { ...BASE_DTO, stops: STOPS });

    expect(fareService.estimate).toHaveBeenCalledWith(
      RideCategory.ECONOMY,
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ stops: STOPS }),
    );
  });
});
