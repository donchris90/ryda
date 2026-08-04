import { CommissionService } from './commission.service';
import { DriverLevel } from '../common/enums/driver-level.enum';
import { VehicleCategory } from '../common/enums/vehicle.enum';
import { CommissionRule } from './entities/commission-rule.entity';

function rule(overrides: Partial<CommissionRule>): CommissionRule {
  return {
    id: 'r1',
    driverLevel: null,
    city: null,
    vehicleCategory: null,
    commissionPercent: '20.00',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as CommissionRule;
}

function makeRepo(rules: CommissionRule[]) {
  return { find: jest.fn().mockResolvedValue(rules) } as any;
}

// Not exercised by these tests (they only cover resolveCommissionPercent),
// just needed to satisfy the constructor's second parameter.
const mockRidesRepo = {} as any;

describe('CommissionService', () => {
  it('falls back to the platform default for the driver level when no rules exist at all', async () => {
    const service = new CommissionService(makeRepo([]), mockRidesRepo);

    const percent = await service.resolveCommissionPercent({ driverLevel: DriverLevel.ROOKIE });

    expect(percent).toBe(25); // DEFAULT_COMMISSION_BY_LEVEL.rookie
  });

  it('uses a level-only rule when nothing more specific matches', async () => {
    const rules = [rule({ driverLevel: DriverLevel.GOLD, commissionPercent: '15.00' })];
    const service = new CommissionService(makeRepo(rules), mockRidesRepo);

    const percent = await service.resolveCommissionPercent({ driverLevel: DriverLevel.GOLD });

    expect(percent).toBe(15);
  });

  it('prefers a more specific rule (level + city) over a less specific one (level only)', async () => {
    const rules = [
      rule({ driverLevel: DriverLevel.GOLD, commissionPercent: '15.00' }),
      rule({ driverLevel: DriverLevel.GOLD, city: 'Lagos', commissionPercent: '12.00' }),
    ];
    const service = new CommissionService(makeRepo(rules), mockRidesRepo);

    const percent = await service.resolveCommissionPercent({ driverLevel: DriverLevel.GOLD, city: 'Lagos' });

    expect(percent).toBe(12);
  });

  it('prefers the MOST specific rule (level + city + vehicle category) over all others', async () => {
    const rules = [
      rule({ driverLevel: DriverLevel.GOLD, commissionPercent: '15.00' }),
      rule({ driverLevel: DriverLevel.GOLD, city: 'Lagos', commissionPercent: '12.00' }),
      rule({
        driverLevel: DriverLevel.GOLD,
        city: 'Lagos',
        vehicleCategory: VehicleCategory.LUXURY,
        commissionPercent: '8.00',
      }),
    ];
    const service = new CommissionService(makeRepo(rules), mockRidesRepo);

    const percent = await service.resolveCommissionPercent({
      driverLevel: DriverLevel.GOLD,
      city: 'Lagos',
      vehicleCategory: VehicleCategory.LUXURY,
    });

    expect(percent).toBe(8);
  });

  it('does not apply a city-specific rule to a ride in a different city', async () => {
    const rules = [rule({ driverLevel: DriverLevel.GOLD, city: 'Abuja', commissionPercent: '5.00' })];
    const service = new CommissionService(makeRepo(rules), mockRidesRepo);

    const percent = await service.resolveCommissionPercent({ driverLevel: DriverLevel.GOLD, city: 'Lagos' });

    // The Abuja-specific rule shouldn't match a Lagos ride — falls back to platform default.
    expect(percent).toBe(18); // DEFAULT_COMMISSION_BY_LEVEL.gold
  });

  it('ignores inactive rules entirely, even if they would otherwise be the most specific match', async () => {
    const rules = [
      rule({ driverLevel: DriverLevel.GOLD, commissionPercent: '15.00' }),
      rule({
        driverLevel: DriverLevel.GOLD,
        city: 'Lagos',
        commissionPercent: '2.00',
        isActive: false,
      }),
    ];
    // The repo mock only returns active rules (matching the real query's WHERE isActive = true),
    // so the inactive one should never even be considered.
    const service = new CommissionService(makeRepo([rules[0]]), mockRidesRepo);

    const percent = await service.resolveCommissionPercent({ driverLevel: DriverLevel.GOLD, city: 'Lagos' });

    expect(percent).toBe(15);
  });
});
