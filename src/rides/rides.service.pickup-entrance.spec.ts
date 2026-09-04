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
  );

  return { service, ridesRepo };
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

describe('RidesService.requestRide() - pickup entrance/access-point', () => {
  it('persists the entrance coordinates when both are supplied', async () => {
    const { service, ridesRepo } = buildService();

    await service.requestRide('passenger-1', {
      ...BASE_DTO,
      pickupEntranceLat: 6.6001,
      pickupEntranceLng: 3.3501,
    });

    expect(ridesRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        pickupEntranceLat: 6.6001,
        pickupEntranceLng: 3.3501,
      }),
    );
  });

  it('stores null (not undefined, not a partial pair) when neither entrance coordinate is supplied', async () => {
    const { service, ridesRepo } = buildService();

    await service.requestRide('passenger-1', BASE_DTO);

    expect(ridesRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ pickupEntranceLat: null, pickupEntranceLng: null }),
    );
  });

  it('discards a lone entrance coordinate rather than persisting an unpaired half-point', async () => {
    const { service, ridesRepo } = buildService();

    await service.requestRide('passenger-1', { ...BASE_DTO, pickupEntranceLat: 6.6001 });

    expect(ridesRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ pickupEntranceLat: null, pickupEntranceLng: null }),
    );
  });
});
