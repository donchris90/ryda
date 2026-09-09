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
    appliesTo: null,
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

// Simulates "nothing configured yet" - returns the fallback unchanged,
// matching what these tests already assume (the hardcoded
// DEFAULT_COMMISSION_BY_LEVEL values, unaffected by settings).
function makeSettingsService(overrides: Record<string, number> = {}) {
  return {
    getNumber: jest.fn((key: string, fallback: number) => Promise.resolve(overrides[key] ?? fallback)),
  } as any;
}
const mockSettingsService = makeSettingsService();

describe('CommissionService', () => {
  it('falls back to the platform default for the driver level when no rules exist at all', async () => {
    const service = new CommissionService(makeRepo([]), mockRidesRepo, mockSettingsService);

    const percent = await service.resolveCommissionPercent({ driverLevel: DriverLevel.ROOKIE, tripType: 'ride' });

    expect(percent).toBe(25); // DEFAULT_COMMISSION_BY_LEVEL.rookie
  });

  it('uses a level-only rule when nothing more specific matches', async () => {
    const rules = [rule({ driverLevel: DriverLevel.GOLD, commissionPercent: '15.00' })];
    const service = new CommissionService(makeRepo(rules), mockRidesRepo, mockSettingsService);

    const percent = await service.resolveCommissionPercent({ driverLevel: DriverLevel.GOLD, tripType: 'ride' });

    expect(percent).toBe(15);
  });

  it('prefers a more specific rule (level + city) over a less specific one (level only)', async () => {
    const rules = [
      rule({ driverLevel: DriverLevel.GOLD, commissionPercent: '15.00' }),
      rule({ driverLevel: DriverLevel.GOLD, city: 'Lagos', commissionPercent: '12.00' }),
    ];
    const service = new CommissionService(makeRepo(rules), mockRidesRepo, mockSettingsService);

    const percent = await service.resolveCommissionPercent({
      driverLevel: DriverLevel.GOLD,
      city: 'Lagos',
      tripType: 'ride',
    });

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
    const service = new CommissionService(makeRepo(rules), mockRidesRepo, mockSettingsService);

    const percent = await service.resolveCommissionPercent({
      driverLevel: DriverLevel.GOLD,
      city: 'Lagos',
      vehicleCategory: VehicleCategory.LUXURY,
      tripType: 'ride',
    });

    expect(percent).toBe(8);
  });

  it('does not apply a city-specific rule to a ride in a different city', async () => {
    const rules = [rule({ driverLevel: DriverLevel.GOLD, city: 'Abuja', commissionPercent: '5.00' })];
    const service = new CommissionService(makeRepo(rules), mockRidesRepo, mockSettingsService);

    const percent = await service.resolveCommissionPercent({
      driverLevel: DriverLevel.GOLD,
      city: 'Lagos',
      tripType: 'ride',
    });

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
    const service = new CommissionService(makeRepo([rules[0]]), mockRidesRepo, mockSettingsService);

    const percent = await service.resolveCommissionPercent({
      driverLevel: DriverLevel.GOLD,
      city: 'Lagos',
      tripType: 'ride',
    });

    expect(percent).toBe(15);
  });

  describe('appliesTo - the real gap this feature fixes: rides and deliveries previously shared every rule and every level default uniformly', () => {
    it('applies a ride-only rule to a ride but not to a delivery for the same driver', async () => {
      const rules = [rule({ driverLevel: DriverLevel.ROOKIE, appliesTo: 'ride', commissionPercent: '30.00' })];
      const service = new CommissionService(makeRepo(rules), mockRidesRepo, mockSettingsService);

      const ridePercent = await service.resolveCommissionPercent({ driverLevel: DriverLevel.ROOKIE, tripType: 'ride' });
      const deliveryPercent = await service.resolveCommissionPercent({
        driverLevel: DriverLevel.ROOKIE,
        tripType: 'delivery',
      });

      expect(ridePercent).toBe(30);
      expect(deliveryPercent).toBe(25); // untouched - DEFAULT_COMMISSION_BY_LEVEL.rookie fallback
    });

    it('applies a delivery-only rule to a delivery but not to a ride for the same driver', async () => {
      const rules = [rule({ driverLevel: DriverLevel.ROOKIE, appliesTo: 'delivery', commissionPercent: '25.00' })];
      const service = new CommissionService(makeRepo(rules), mockRidesRepo, mockSettingsService);

      const ridePercent = await service.resolveCommissionPercent({ driverLevel: DriverLevel.ROOKIE, tripType: 'ride' });
      const deliveryPercent = await service.resolveCommissionPercent({
        driverLevel: DriverLevel.ROOKIE,
        tripType: 'delivery',
      });

      expect(ridePercent).toBe(25); // untouched - DEFAULT_COMMISSION_BY_LEVEL.rookie fallback
      expect(deliveryPercent).toBe(25);
    });

    it('a rule with no appliesTo set (null) still applies to both, unchanged from before this feature existed', async () => {
      const rules = [rule({ driverLevel: DriverLevel.ROOKIE, appliesTo: null, commissionPercent: '10.00' })];
      const service = new CommissionService(makeRepo(rules), mockRidesRepo, mockSettingsService);

      const ridePercent = await service.resolveCommissionPercent({ driverLevel: DriverLevel.ROOKIE, tripType: 'ride' });
      const deliveryPercent = await service.resolveCommissionPercent({
        driverLevel: DriverLevel.ROOKIE,
        tripType: 'delivery',
      });

      expect(ridePercent).toBe(10);
      expect(deliveryPercent).toBe(10);
    });

    it(
      'when no delivery-specific default has been configured, delivery falls back to whatever the ride ' +
        'default currently resolves to - not the original hardcoded constant - so an admin who already ' +
        'customized the ride default sees deliveries keep matching it until they set one specifically',
      async () => {
        const settingsService = makeSettingsService({ 'commission.default.rookie': 40 });
        const service = new CommissionService(makeRepo([]), mockRidesRepo, settingsService);

        const deliveryPercent = await service.resolveCommissionPercent({
          driverLevel: DriverLevel.ROOKIE,
          tripType: 'delivery',
        });

        expect(deliveryPercent).toBe(40);
      },
    );

    it('a delivery-specific default, once set, wins over the ride default fallback', async () => {
      const settingsService = makeSettingsService({
        'commission.default.rookie': 40,
        'commission.default.delivery.rookie': 25,
      });
      const service = new CommissionService(makeRepo([]), mockRidesRepo, settingsService);

      const deliveryPercent = await service.resolveCommissionPercent({
        driverLevel: DriverLevel.ROOKIE,
        tripType: 'delivery',
      });

      expect(deliveryPercent).toBe(25);
    });
  });
});
