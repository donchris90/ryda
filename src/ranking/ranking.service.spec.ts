import { DriverRankingService } from './ranking.service';
import { EtaSource } from './ranking.types';
import { CandidateResult } from '../candidate-search/candidate-search.types';
import { VehicleCategory } from '../common/enums/vehicle.enum';
import { DriverLevel } from '../common/enums/driver-level.enum';

const PICKUP = { lat: 6.5244, lng: 3.3792 };

function candidate(overrides: Partial<CandidateResult> = {}): CandidateResult {
  return {
    driverUserId: 'driver-x',
    driverProfileId: 'profile-x',
    vehicleId: 'vehicle-x',
    vehicleCategory: VehicleCategory.CAR,
    lat: PICKUP.lat + 0.01,
    lng: PICKUP.lng + 0.01,
    distanceKm: 2,
    rating: 4.8,
    level: DriverLevel.STANDARD,
    ...overrides,
  };
}

function fakeConfig(etaCandidateLimit = 8) {
  return { get: (key: string) => (key === 'dispatch.etaCandidateLimit' ? etaCandidateLimit : undefined) } as any;
}

/** Minimal metrics fake — just enough surface for DriverRankingService's calls. */
function fakeMetrics() {
  return {
    rankingCandidateCount: { observe: jest.fn() },
    rankingRankedCount: { observe: jest.fn() },
    rankingRoutingFailuresTotal: { inc: jest.fn() },
    rankingFallbackUsedTotal: { inc: jest.fn() },
    etaCalculationDurationSeconds: { startTimer: () => jest.fn() },
  } as any;
}

describe('DriverRankingService', () => {
  let googleMaps: { getDirections: jest.Mock };
  let metrics: ReturnType<typeof fakeMetrics>;

  function build(etaCandidateLimit = 8) {
    googleMaps = { getDirections: jest.fn() };
    metrics = fakeMetrics();
    return new DriverRankingService(googleMaps as any, fakeConfig(etaCandidateLimit), metrics);
  }

  it('a shorter road ETA beats a shorter straight-line distance', async () => {
    const service = build();
    const closeButSlow = candidate({ driverUserId: 'close-slow', distanceKm: 2.0, lat: PICKUP.lat + 0.01, lng: PICKUP.lng });
    const fartherButFast = candidate({
      driverUserId: 'far-fast',
      distanceKm: 3.2,
      lat: PICKUP.lat + 0.02,
      lng: PICKUP.lng,
    });

    googleMaps.getDirections.mockImplementation(async (origin: { lat: number; lng: number }) => {
      if (origin.lat === closeButSlow.lat) {
        return { distanceKm: 2.0, durationMin: 17, polyline: null };
      }
      return { distanceKm: 3.2, durationMin: 9, polyline: null };
    });

    const outcome = await service.rank(PICKUP, [closeButSlow, fartherButFast]);

    expect(outcome.ranked.map((c) => c.driverUserId)).toEqual(['far-fast', 'close-slow']);
    expect(outcome.ranked[0].etaMinutes).toBe(9);
    expect(outcome.ranked[0].etaSource).toBe(EtaSource.ROUTING);
  });

  it('produces a stable ranking order by ascending ETA across more than two candidates', async () => {
    const service = build();
    const a = candidate({ driverUserId: 'a' });
    const b = candidate({ driverUserId: 'b' });
    const c = candidate({ driverUserId: 'c' });

    googleMaps.getDirections
      .mockResolvedValueOnce({ distanceKm: 1, durationMin: 12, polyline: null })
      .mockResolvedValueOnce({ distanceKm: 1, durationMin: 4, polyline: null })
      .mockResolvedValueOnce({ distanceKm: 1, durationMin: 8, polyline: null });

    const outcome = await service.rank(PICKUP, [a, b, c]);

    expect(outcome.ranked.map((r) => r.etaMinutes)).toEqual([4, 8, 12]);
  });

  it('falls back to a distance-based ETA when the routing API returns null, without crashing', async () => {
    const service = build();
    googleMaps.getDirections.mockResolvedValue(null);

    const outcome = await service.rank(PICKUP, [candidate({ distanceKm: 14 })]);

    expect(outcome.ranked).toHaveLength(1);
    expect(outcome.ranked[0].etaSource).toBe(EtaSource.FALLBACK_DISTANCE);
    // 14km / 28km/h * 60 = 30 minutes
    expect(outcome.ranked[0].etaMinutes).toBe(30);
    expect(outcome.fallbackUsed).toBe(true);
    expect(outcome.routingFailures).toBe(1);
  });

  it('falls back gracefully if the routing call throws outright', async () => {
    const service = build();
    googleMaps.getDirections.mockRejectedValue(new Error('network blew up'));

    const outcome = await expect(service.rank(PICKUP, [candidate()])).resolves.toBeDefined();
    const result = await service.rank(PICKUP, [candidate()]);

    expect(result.ranked[0].etaSource).toBe(EtaSource.FALLBACK_DISTANCE);
    expect(result.fallbackUsed).toBe(true);
  });

  it('never treats a fallback ETA as a real routing result even when it happens to tie with one', async () => {
    const service = build();
    // distanceKm chosen so fallback (distanceKm/28*60) equals a plausible routing duration
    const routed = candidate({ driverUserId: 'routed', distanceKm: 1, lat: PICKUP.lat + 0.01, lng: PICKUP.lng });
    const fallback = candidate({
      driverUserId: 'fell-back',
      distanceKm: 4.6667, // ~10 min fallback
      lat: PICKUP.lat + 0.02,
      lng: PICKUP.lng,
    });

    googleMaps.getDirections.mockImplementation(async (origin: { lat: number; lng: number }) => {
      if (origin.lat === routed.lat) return { distanceKm: 1, durationMin: 10, polyline: null };
      return null;
    });

    const outcome = await service.rank(PICKUP, [routed, fallback]);

    const routedEntry = outcome.ranked.find((c) => c.driverUserId === 'routed')!;
    const fallbackEntry = outcome.ranked.find((c) => c.driverUserId === 'fell-back')!;
    expect(routedEntry.etaSource).toBe(EtaSource.ROUTING);
    expect(fallbackEntry.etaSource).toBe(EtaSource.FALLBACK_DISTANCE);
  });

  it('only calls the routing API for the configured candidate limit, not every candidate', async () => {
    const service = build(3);
    googleMaps.getDirections.mockResolvedValue({ distanceKm: 1, durationMin: 5, polyline: null });

    const candidates = Array.from({ length: 20 }, (_, i) =>
      candidate({ driverUserId: `driver-${i}`, distanceKm: i + 1 }),
    );

    const outcome = await service.rank(PICKUP, candidates);

    expect(googleMaps.getDirections).toHaveBeenCalledTimes(3);
    expect(outcome.routingCallsMade).toBe(3);
    // The other 17 still get a ranked (fallback) entry — none are silently dropped.
    expect(outcome.ranked).toHaveLength(20);
  });

  it('makes no routing calls at all when there are no candidates', async () => {
    const service = build();

    const outcome = await service.rank(PICKUP, []);

    expect(googleMaps.getDirections).not.toHaveBeenCalled();
    expect(outcome.ranked).toEqual([]);
    expect(outcome.routingCallsMade).toBe(0);
  });

  it('ranks deterministically by distance then driver id when ETAs are exactly equal', async () => {
    const service = build();
    const a = candidate({ driverUserId: 'zzz', distanceKm: 2 });
    const b = candidate({ driverUserId: 'aaa', distanceKm: 2 });
    googleMaps.getDirections.mockResolvedValue({ distanceKm: 2, durationMin: 10, polyline: null });

    const outcome = await service.rank(PICKUP, [a, b]);

    expect(outcome.ranked.map((c) => c.driverUserId)).toEqual(['aaa', 'zzz']);
  });

  it('records routing-call and fallback counts accurately across a mixed batch', async () => {
    const service = build(5);
    googleMaps.getDirections
      .mockResolvedValueOnce({ distanceKm: 1, durationMin: 5, polyline: null })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ distanceKm: 1, durationMin: 6, polyline: null });

    const outcome = await service.rank(PICKUP, [
      candidate({ driverUserId: 'x1' }),
      candidate({ driverUserId: 'x2' }),
      candidate({ driverUserId: 'x3' }),
    ]);

    expect(outcome.routingCallsMade).toBe(3);
    expect(outcome.routingFailures).toBe(1);
    expect(outcome.fallbackUsed).toBe(true);
  });
});
