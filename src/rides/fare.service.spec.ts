import { FareService } from './fare.service';
import { RideCategory } from '../common/enums/ride.enum';

const PRICING_CONFIG: Record<string, any> = {
  'pricing.perKm': 120,
  'pricing.minimumFare': 700,
  'pricing.tierMinutes': 5,
  'pricing.tierBaseFare': 1700,
  'pricing.tierIncrementFare': 700,
  'pricing.currency': 'NGN',
  'pricingExtra.nightStartHour': 22,
  'pricingExtra.nightEndHour': 5,
  'pricingExtra.nightMultiplier': 1.15,
  'pricingExtra.airportFee': 1000,
  'pricingExtra.freeWaitMinutes': 5,
  'pricingExtra.perMinuteWaitRate': 30,
  'pricingExtra.cancellationFee': 500,
};

function makeConfigService() {
  return { get: (key: string) => PRICING_CONFIG[key] } as any;
}

function makeGoogleMapsService(configured = false) {
  return {
    isConfigured: () => configured,
    getDirections: jest.fn(),
  } as any;
}

function makeSettingsService(overrides: Record<string, number> = {}) {
  return {
    getNumber: jest.fn(async (key: string, fallback: number) => overrides[key] ?? fallback),
  } as any;
}

describe('FareService', () => {
  // Ikeja -> Victoria Island, Lagos — a known ~20.8km real-world distance,
  // used throughout so results are easy to sanity-check by hand.
  const pickup = { lat: 6.6018, lng: 3.3515 };
  const dropoff = { lat: 6.4281, lng: 3.4219 };

  it('computes tiered-time + distance fare with the economy multiplier (1x) and floors at the minimum fare', async () => {
    const service = new FareService(makeConfigService(), makeGoogleMapsService(), makeSettingsService());
    // Force a daytime hour so the night multiplier doesn't interfere with this test.
    const daytime = new Date('2026-01-01T14:00:00');

    const result = await service.estimate(RideCategory.ECONOMY, pickup, dropoff, { at: daytime });

    // baseFare is no longer a separate line item — the first time-tier
    // block (tierBaseFare) now covers what a flat base fare used to.
    expect(result.baseFare).toBe(0);
    // timeFare should reflect the tiered schedule (₦1700 first 5 min +
    // ₦700 per additional 5-min block), not a flat per-minute rate.
    expect(result.timeFare).toBeGreaterThanOrEqual(1700);
    expect(result.estimatedDistanceKm).toBeGreaterThan(20);
    expect(result.estimatedDistanceKm).toBeLessThan(22);
    expect(result.usedRealRouting).toBe(false); // Maps not configured in this test
    // total should be well above the 700 minimum for a 20km trip
    expect(result.totalFare).toBeGreaterThan(700);
  });

  it('applies the category multiplier — comfort (1.25x) costs more than economy for the same trip', async () => {
    const service = new FareService(makeConfigService(), makeGoogleMapsService(), makeSettingsService());
    const daytime = new Date('2026-01-01T14:00:00');

    const economy = await service.estimate(RideCategory.ECONOMY, pickup, dropoff, { at: daytime });
    const comfort = await service.estimate(RideCategory.COMFORT, pickup, dropoff, { at: daytime });

    expect(comfort.totalFare).toBeGreaterThan(economy.totalFare);
  });

  it('applies the night multiplier during night hours and not during the day', async () => {
    const service = new FareService(makeConfigService(), makeGoogleMapsService(), makeSettingsService());
    const day = new Date('2026-01-01T14:00:00'); // 2pm — not night
    const night = new Date('2026-01-01T23:00:00'); // 11pm — night (22:00-05:00 window)

    const dayFare = await service.estimate(RideCategory.ECONOMY, pickup, dropoff, { at: day });
    const nightFare = await service.estimate(RideCategory.ECONOMY, pickup, dropoff, { at: night });

    expect(nightFare.nightMultiplierApplied).toBeCloseTo(1.15);
    expect(dayFare.nightMultiplierApplied).toBeCloseTo(1.0);
    expect(nightFare.totalFare).toBeGreaterThan(dayFare.totalFare);
  });

  it('handles the night window wraparound correctly (e.g. 2am counts as night)', async () => {
    const service = new FareService(makeConfigService(), makeGoogleMapsService(), makeSettingsService());
    const earlyMorning = new Date('2026-01-01T02:00:00'); // 2am, inside 22:00->05:00 wraparound

    const result = await service.estimate(RideCategory.ECONOMY, pickup, dropoff, { at: earlyMorning });

    expect(result.nightMultiplierApplied).toBeCloseTo(1.15);
  });

  it('adds the flat airport fee only when isAirportTrip is true', async () => {
    const service = new FareService(makeConfigService(), makeGoogleMapsService(), makeSettingsService());
    const daytime = new Date('2026-01-01T14:00:00');

    const normal = await service.estimate(RideCategory.ECONOMY, pickup, dropoff, { at: daytime });
    const airport = await service.estimate(RideCategory.ECONOMY, pickup, dropoff, {
      at: daytime,
      isAirportTrip: true,
    });

    expect(airport.airportFee).toBeCloseTo(1000);
    expect(normal.airportFee).toBe(0);
    // Airport trip should cost exactly the fee more (fee is added after
    // surge/night multiplier, not multiplied itself).
    expect(airport.totalFare - normal.totalFare).toBeCloseTo(1000, 0);
  });

  it('applies a caller-supplied surge multiplier on top of everything else', async () => {
    const service = new FareService(makeConfigService(), makeGoogleMapsService(), makeSettingsService());
    const daytime = new Date('2026-01-01T14:00:00');

    const normal = await service.estimate(RideCategory.ECONOMY, pickup, dropoff, { at: daytime });
    const surged = await service.estimate(RideCategory.ECONOMY, pickup, dropoff, {
      at: daytime,
      surgeMultiplier: 2.0,
    });

    expect(surged.totalFare).toBeGreaterThan(normal.totalFare * 1.8);
  });

  it('never charges less than the configured minimum fare, even for a tiny distance', async () => {
    const service = new FareService(makeConfigService(), makeGoogleMapsService(), makeSettingsService());
    const veryClose = { lat: 6.6018, lng: 3.3515 };
    const almostSamePoint = { lat: 6.6019, lng: 3.3516 };

    const result = await service.estimate(RideCategory.ECONOMY, veryClose, almostSamePoint, {
      at: new Date('2026-01-01T14:00:00'),
    });

    expect(result.totalFare).toBeGreaterThanOrEqual(700);
  });

  it('uses real Google Maps routing when configured, and reports usedRealRouting: true', async () => {
    const maps = makeGoogleMapsService(true);
    maps.getDirections.mockResolvedValue({ distanceKm: 25, durationMin: 40, polyline: null });
    const service = new FareService(makeConfigService(), maps, makeSettingsService());

    const result = await service.estimate(RideCategory.ECONOMY, pickup, dropoff, {
      at: new Date('2026-01-01T14:00:00'),
    });

    expect(result.usedRealRouting).toBe(true);
    expect(result.estimatedDistanceKm).toBe(25);
  });

  it('falls back to Haversine if the configured Maps call fails', async () => {
    const maps = makeGoogleMapsService(true);
    maps.getDirections.mockResolvedValue(null); // simulates a failed/errored Directions call
    const service = new FareService(makeConfigService(), maps, makeSettingsService());

    const result = await service.estimate(RideCategory.ECONOMY, pickup, dropoff, {
      at: new Date('2026-01-01T14:00:00'),
    });

    expect(result.usedRealRouting).toBe(false);
  });

  it('calculates a waiting fee only for minutes past the free grace period', () => {
    const service = new FareService(makeConfigService(), makeGoogleMapsService(), makeSettingsService());
    const arrivedAt = new Date('2026-01-01T10:00:00');
    const startedAt = new Date('2026-01-01T10:10:00'); // 10 minutes later

    // 5 free minutes, 5 billable minutes at 30/min = 150
    const fee = service.calculateWaitingFee(arrivedAt, startedAt);
    expect(fee).toBeCloseTo(150);
  });

  it('charges no waiting fee within the free grace period', () => {
    const service = new FareService(makeConfigService(), makeGoogleMapsService(), makeSettingsService());
    const arrivedAt = new Date('2026-01-01T10:00:00');
    const startedAt = new Date('2026-01-01T10:03:00'); // 3 minutes — within the 5-minute grace

    expect(service.calculateWaitingFee(arrivedAt, startedAt)).toBe(0);
  });

  it('uses the DB-configured cancellation fee override when set, falling back to env config otherwise', async () => {
    const withOverride = new FareService(
      makeConfigService(),
      makeGoogleMapsService(),
      makeSettingsService({ 'pricing.cancellationFee': 1500 }),
    );
    const withoutOverride = new FareService(makeConfigService(), makeGoogleMapsService(), makeSettingsService());

    expect(await withOverride.getCancellationFee()).toBe(1500);
    expect(await withoutOverride.getCancellationFee()).toBe(500); // env default
  });
});
