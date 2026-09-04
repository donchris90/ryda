import { BadRequestException } from '@nestjs/common';
import { RidesService } from './rides.service';
import { PaymentMethod, RideCategory } from '../common/enums/ride.enum';

function buildService(overrides: { corporateService?: any } = {}) {
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
  const corporateService = {
    getAccountForEmployee: jest.fn().mockResolvedValue({ id: 'account-1' }),
    checkRidePolicy: jest.fn().mockReturnValue({ allowed: true }),
    checkEmployeeSpendLimit: jest.fn().mockResolvedValue({ allowed: true }),
    ...overrides.corporateService,
  };
  const events = { emit: jest.fn() };
  const metricsService = { rideRequestsTotal: { inc: jest.fn() } };
  const geofenceService = { isWithinServiceArea: jest.fn().mockResolvedValue(true), checkPoint: jest.fn().mockResolvedValue([]) };

  const scheduledRidesQueue = { add: jest.fn().mockResolvedValue(undefined) };
  const settingsService = { getNumber: jest.fn().mockImplementation((_key, fallback) => Promise.resolve(fallback)) };

  const service = new RidesService(
    ridesRepo as any,
    fareService as any,
    {} as any, {} as any, {} as any, {} as any, {} as any,
    {} as any,
    corporateService as any,
    passengersService as any,
    {} as any, {} as any, {} as any, {} as any,
    pricingService as any,
    events as any,
    { get: jest.fn() } as any,
    scheduledRidesQueue as any,
    {} as any,
    settingsService as any,
    metricsService as any,
    {} as any, {} as any, {} as any,
    geofenceService as any,
    {} as any, // airportService
    {} as any, // fraudService
    {} as any, // poolMatchingService (not exercised by this suite)
    {} as any, // featureFlagsService (not exercised by this suite)
  );

  return { service, ridesRepo, corporateService };
}

const BASE_DTO = {
  category: RideCategory.ECONOMY,
  pickupLat: 6.6,
  pickupLng: 3.35,
  pickupAddress: 'A',
  dropoffLat: 6.5,
  dropoffLng: 3.3,
  dropoffAddress: 'B',
  paymentMethod: PaymentMethod.CORPORATE,
  city: 'Lagos',
} as any;

describe('RidesService.requestRide() - corporate ride policy enforcement', () => {
  it('checks the policy against the SAME fare estimate the ride is about to be created with', async () => {
    const { service, corporateService } = buildService();

    await service.requestRide('passenger-1', BASE_DTO);

    expect(corporateService.checkRidePolicy).toHaveBeenCalledWith(
      { id: 'account-1' },
      expect.objectContaining({ category: RideCategory.ECONOMY, estimatedFare: 900, city: 'Lagos' }),
    );
  });

  it('refuses the ride with the policy-provided reason when the policy check fails', async () => {
    const { service } = buildService({
      corporateService: { checkRidePolicy: jest.fn().mockReturnValue({ allowed: false, reason: 'Exceeds your company limit' }) },
    });

    await expect(service.requestRide('passenger-1', BASE_DTO)).rejects.toThrow('Exceeds your company limit');
  });

  it('never even calls the policy check for a non-corporate payment method', async () => {
    const { service, corporateService } = buildService();

    await service.requestRide('passenger-1', { ...BASE_DTO, paymentMethod: PaymentMethod.WALLET });

    expect(corporateService.checkRidePolicy).not.toHaveBeenCalled();
  });

  it('checks the policy against the SCHEDULED time for a scheduled ride, not the booking time', async () => {
    const { service, corporateService } = buildService();
    const futureDate = new Date(Date.now() + 3600_000).toISOString();

    await service.requestRide('passenger-1', { ...BASE_DTO, scheduledAt: futureDate });

    const checkedRide = corporateService.checkRidePolicy.mock.calls[0][1];
    expect(checkedRide.requestedAt.toISOString()).toBe(futureDate);
  });

  it('still refuses the ride when there is no corporate account at all - existing behavior, unaffected by the new policy check', async () => {
    const { service } = buildService({
      corporateService: { getAccountForEmployee: jest.fn().mockResolvedValue(null) },
    });

    await expect(service.requestRide('passenger-1', BASE_DTO)).rejects.toThrow(BadRequestException);
  });

  it("refuses the ride with the spend-limit reason when the employee's own monthly limit would be exceeded", async () => {
    const { service } = buildService({
      corporateService: { checkEmployeeSpendLimit: jest.fn().mockResolvedValue({ allowed: false, reason: 'Exceeds your monthly limit' }) },
    });

    await expect(service.requestRide('passenger-1', BASE_DTO)).rejects.toThrow('Exceeds your monthly limit');
  });

  it('checks the spend limit for the requesting PASSENGER specifically, with this fare', async () => {
    const { service, corporateService } = buildService();

    await service.requestRide('passenger-1', BASE_DTO);

    expect(corporateService.checkEmployeeSpendLimit).toHaveBeenCalledWith('passenger-1', 900);
  });

  it('checks the account-wide policy before the individual spend limit - a category violation is reported first', async () => {
    const { service, corporateService } = buildService({
      corporateService: { checkRidePolicy: jest.fn().mockReturnValue({ allowed: false, reason: 'Category not allowed' }) },
    });

    await expect(service.requestRide('passenger-1', BASE_DTO)).rejects.toThrow('Category not allowed');
    expect(corporateService.checkEmployeeSpendLimit).not.toHaveBeenCalled();
  });
});
