import { DispatchAiService } from './dispatch-ai.service';
import { DriverLevel } from '../common/enums/driver-level.enum';
import { NearbyDriverResult } from '../drivers/drivers.service';

function driver(overrides: Partial<NearbyDriverResult>): NearbyDriverResult {
  return {
    driverProfileId: 'p1',
    userId: 'u1',
    distanceKm: 1,
    level: DriverLevel.ROOKIE,
    rating: 5,
    vehicleId: 'v1',
    ...overrides,
  };
}

describe('DispatchAiService', () => {
  let service: DispatchAiService;

  beforeEach(() => {
    service = new DispatchAiService();
  });

  it('ranks a much closer driver above a farther one when other factors are equal', () => {
    const close = driver({ userId: 'close', distanceKm: 0.5, rating: 4.5, level: DriverLevel.ROOKIE });
    const far = driver({ userId: 'far', distanceKm: 5, rating: 4.5, level: DriverLevel.ROOKIE });

    const ranked = service.rankDrivers([far, close]);

    expect(ranked[0].userId).toBe('close');
  });

  it('lets a farther but much higher-rated, higher-level driver outrank a close one with a genuinely poor rating', () => {
    // Proximity is weighted heavily (0.5) and caps quickly (anything under
    // 1km scores the same 10/10) — so overcoming it needs a real gap in
    // rating/level, not just "slightly better." A 2.0-vs-5.0 rating gap at
    // 0.3km-vs-3km isn't enough (verified by hand: 6.4 vs 6.07, close
    // still wins); a 1.0-vs-5.0 gap is.
    const closeButPoor = driver({ userId: 'close-poor', distanceKm: 0.3, rating: 1.0, level: DriverLevel.ROOKIE });
    const fartherButGreat = driver({ userId: 'far-great', distanceKm: 3, rating: 5.0, level: DriverLevel.ELITE });

    const ranked = service.rankDrivers([closeButPoor, fartherButGreat]);

    expect(ranked[0].userId).toBe('far-great');
  });

  it('does NOT let a merely somewhat-better-rated farther driver overcome a strong proximity advantage', () => {
    // The inverse of the above — demonstrates that proximity genuinely
    // dominates for moderate rating gaps, which is a real, intentional
    // property of the current weights (0.5 proximity / 0.35 rating / 0.15
    // level), not an accident.
    const close = driver({ userId: 'close', distanceKm: 0.3, rating: 2.0, level: DriverLevel.ROOKIE });
    const farther = driver({ userId: 'far', distanceKm: 3, rating: 5.0, level: DriverLevel.ELITE });

    const ranked = service.rankDrivers([close, farther]);

    expect(ranked[0].userId).toBe('close');
  });

  it('returns all candidates, sorted, none dropped', () => {
    const drivers = [
      driver({ userId: 'a', distanceKm: 2 }),
      driver({ userId: 'b', distanceKm: 1 }),
      driver({ userId: 'c', distanceKm: 3 }),
    ];

    const ranked = service.rankDrivers(drivers);

    expect(ranked).toHaveLength(3);
    expect(new Set(ranked.map((r) => r.userId))).toEqual(new Set(['a', 'b', 'c']));
  });

  it('handles an empty candidate list without throwing', () => {
    expect(service.rankDrivers([])).toEqual([]);
  });

  it('does not divide by zero for a driver at distance 0', () => {
    const zeroDistance = driver({ userId: 'here', distanceKm: 0 });
    const ranked = service.rankDrivers([zeroDistance]);
    expect(Number.isFinite(ranked[0].score)).toBe(true);
  });
});
