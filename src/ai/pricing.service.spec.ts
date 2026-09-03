import { PricingService } from './pricing.service';

function makeRepos(rideCount: number, driverCount: number) {
  const ridesRepo = { count: jest.fn().mockResolvedValue(rideCount) } as any;
  const driversRepo = { count: jest.fn().mockResolvedValue(driverCount) } as any;
  return { ridesRepo, driversRepo };
}

describe('PricingService (surge)', () => {
  it('returns baseline 1.0x with no activity at all', async () => {
    const { ridesRepo, driversRepo } = makeRepos(0, 0);
    const service = new PricingService(ridesRepo, driversRepo);

    const result = await service.calculateSurge('Lagos');

    expect(result.multiplier).toBe(1.0);
    expect(result.reason).toMatch(/no activity/i);
  });

  it('caps at 3.0x when there is demand but zero available drivers', async () => {
    const { ridesRepo, driversRepo } = makeRepos(5, 0);
    const service = new PricingService(ridesRepo, driversRepo);

    const result = await service.calculateSurge('Lagos');

    expect(result.multiplier).toBe(3.0);
    expect(result.reason).toMatch(/no drivers/i);
  });

  it('stays at 1.0x when demand exactly equals supply (1 rider per driver)', async () => {
    const { ridesRepo, driversRepo } = makeRepos(3, 3);
    const service = new PricingService(ridesRepo, driversRepo);

    const result = await service.calculateSurge('Lagos');

    expect(result.multiplier).toBe(1.0);
  });

  it('scales up gradually as the demand/supply ratio increases beyond 1', async () => {
    const { ridesRepo, driversRepo } = makeRepos(6, 3); // ratio 2.0
    const service = new PricingService(ridesRepo, driversRepo);

    const result = await service.calculateSurge('Lagos');

    // formula: 1 + max(0, ratio - 1) * 0.5 = 1 + 1 * 0.5 = 1.5
    expect(result.multiplier).toBe(1.5);
  });

  it('never exceeds the 3.0x cap even with an extreme demand/supply ratio', async () => {
    const { ridesRepo, driversRepo } = makeRepos(100, 2); // ratio 50
    const service = new PricingService(ridesRepo, driversRepo);

    const result = await service.calculateSurge('Lagos');

    expect(result.multiplier).toBe(3.0);
  });

  it('never goes below 1.0x when supply exceeds demand', async () => {
    const { ridesRepo, driversRepo } = makeRepos(1, 10);
    const service = new PricingService(ridesRepo, driversRepo);

    const result = await service.calculateSurge('Lagos');

    expect(result.multiplier).toBe(1.0);
  });

  it('reports the raw openDemand/availableSupply counts alongside the multiplier', async () => {
    const { ridesRepo, driversRepo } = makeRepos(7, 2);
    const service = new PricingService(ridesRepo, driversRepo);

    const result = await service.calculateSurge('Lagos');

    expect(result.openDemand).toBe(7);
    expect(result.availableSupply).toBe(2);
  });
});

describe('PricingService.calculateSurgeForDriver()', () => {
  it("scopes the surge computation to the driver's own registered city", async () => {
    const { ridesRepo, driversRepo } = makeRepos(6, 3); // ratio 2.0 -> surge
    driversRepo.findOne = jest.fn().mockResolvedValue({ userId: 'driver-1', city: 'Lagos' });
    const service = new PricingService(ridesRepo, driversRepo);

    const result = await service.calculateSurgeForDriver('driver-1');

    expect(driversRepo.count).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ city: 'Lagos' }) }));
    expect(result.multiplier).toBeGreaterThan(1.0);
  });

  it('falls back to the unscoped nationwide figure when the driver has no registered city', async () => {
    const { ridesRepo, driversRepo } = makeRepos(2, 2);
    driversRepo.findOne = jest.fn().mockResolvedValue({ userId: 'driver-1', city: null });
    const service = new PricingService(ridesRepo, driversRepo);

    const result = await service.calculateSurgeForDriver('driver-1');

    expect(driversRepo.count).toHaveBeenCalledWith(expect.objectContaining({ where: expect.not.objectContaining({ city: expect.anything() }) }));
    expect(result).toBeDefined();
  });

  it('falls back to the unscoped figure (not an error) when the driver profile itself cannot be found', async () => {
    const { ridesRepo, driversRepo } = makeRepos(0, 0);
    driversRepo.findOne = jest.fn().mockResolvedValue(null);
    const service = new PricingService(ridesRepo, driversRepo);

    const result = await service.calculateSurgeForDriver('driver-missing');

    expect(result.multiplier).toBe(1.0);
  });
});
