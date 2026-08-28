import { LiveDriverIndexService } from './live-driver-index.service';
import { RydaRedisKeys } from './redis-keys';
import { DriverAvailability, DriverApprovalStatus } from '../common/enums/driver-status.enum';

/**
 * Minimal fake standing in for ioredis: enough pipeline/geosearch/hgetall
 * surface for LiveDriverIndexService, backed by a plain in-memory map so
 * assertions can check real end states rather than mock call arguments.
 */
class FakeRedis {
  geo = new Map<string, { lon: number; lat: number }>(); // member -> coords
  meta = new Map<string, Record<string, string>>(); // key -> hash
  failNext = false;

  pipeline() {
    const ops: Array<() => void> = [];
    const self = this;
    const chain: any = {
      geoadd(_key: string, lon: number, lat: number, member: string) {
        ops.push(() => self.geo.set(member, { lon, lat }));
        return chain;
      },
      hset(key: string, fields: Record<string, string>) {
        ops.push(() => self.meta.set(key, { ...(self.meta.get(key) ?? {}), ...fields }));
        return chain;
      },
      zrem(_key: string, member: string) {
        ops.push(() => self.geo.delete(member));
        return chain;
      },
      del(key: string) {
        ops.push(() => self.meta.delete(key));
        return chain;
      },
      hgetall(key: string) {
        ops.push(() => {});
        (chain as any)._lastHgetallKeys = (chain as any)._lastHgetallKeys ?? [];
        (chain as any)._lastHgetallKeys.push(key);
        return chain;
      },
      async exec() {
        if (self.failNext) {
          self.failNext = false;
          throw new Error('simulated redis failure');
        }
        const hgetallKeys: string[] = (chain as any)._lastHgetallKeys ?? [];
        ops.forEach((op) => op());
        if (hgetallKeys.length) {
          return hgetallKeys.map((key) => [null, self.meta.get(key) ?? null]);
        }
        return ops.map(() => [null, 'OK']);
      },
    };
    return chain;
  }

  async zcard(_key: string): Promise<number> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('simulated redis failure');
    }
    return this.geo.size;
  }

  async geosearch(
    _key: string,
    _fromlonlat: string,
    lon: number,
    lat: number,
    _byradius: string,
    radiusKm: number,
  ) {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('simulated redis failure');
    }
    const results: Array<[string, string, [string, string]]> = [];
    for (const [member, coords] of this.geo.entries()) {
      const distanceKm = haversine(lat, lon, coords.lat, coords.lon);
      if (distanceKm <= radiusKm) {
        results.push([member, distanceKm.toFixed(4), [String(coords.lon), String(coords.lat)]]);
      }
    }
    results.sort((a, b) => parseFloat(a[1]) - parseFloat(b[1]));
    return results as any;
  }
}

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function fakeConfig(staleSeconds = 120) {
  return { get: (key: string) => (key === 'driverLocation.staleSeconds' ? staleSeconds : undefined) } as any;
}

function fakeMetrics() {
  return {
    driverLocationUpdatesTotal: { inc: jest.fn() },
    availableDriverCount: { set: jest.fn() },
  } as any;
}

const LAGOS = { lat: 6.5244, lng: 3.3792 };

describe('LiveDriverIndexService', () => {
  let redis: FakeRedis;
  let metrics: ReturnType<typeof fakeMetrics>;
  let service: LiveDriverIndexService;

  beforeEach(() => {
    redis = new FakeRedis();
    metrics = fakeMetrics();
    service = new LiveDriverIndexService(redis as any, fakeConfig(), metrics);
  });

  describe('upsert / remove (Redis registration and removal)', () => {
    it('registers a driver into the geo index and metadata hash', async () => {
      await service.upsert({
        driverUserId: 'driver-1',
        driverProfileId: 'profile-1',
        lat: LAGOS.lat,
        lng: LAGOS.lng,
        vehicleId: 'vehicle-1',
      });

      expect(redis.geo.has('driver-1')).toBe(true);
      const meta = redis.meta.get(RydaRedisKeys.liveDriverMeta('driver-1'));
      expect(meta?.driverProfileId).toBe('profile-1');
      expect(meta?.vehicleId).toBe('vehicle-1');
      expect(meta?.updatedAt).toBeDefined();
    });

    it('removes a driver from both the geo index and metadata hash', async () => {
      await service.upsert({
        driverUserId: 'driver-1',
        driverProfileId: 'profile-1',
        lat: LAGOS.lat,
        lng: LAGOS.lng,
        vehicleId: null,
      });

      await service.remove('driver-1');

      expect(redis.geo.has('driver-1')).toBe(false);
      expect(redis.meta.has(RydaRedisKeys.liveDriverMeta('driver-1'))).toBe(false);
    });

    it('refuses to index non-finite coordinates', async () => {
      await service.upsert({
        driverUserId: 'driver-bad',
        driverProfileId: 'profile-1',
        lat: NaN,
        lng: LAGOS.lng,
        vehicleId: null,
      });

      expect(redis.geo.has('driver-bad')).toBe(false);
    });
  });

  describe('driver.availability.changed handling', () => {
    const baseline = {
      driverUserId: 'driver-1',
      driverProfileId: 'profile-1',
      vehicleId: 'vehicle-1',
      lat: LAGOS.lat,
      lng: LAGOS.lng,
      locationUpdatedAt: new Date(),
    };

    it('driver becomes ONLINE with a fresh existing location: is added to the index', async () => {
      await service.onAvailabilityChanged({
        ...baseline,
        previous: DriverAvailability.OFFLINE,
        availability: DriverAvailability.ONLINE,
      });

      expect(redis.geo.has('driver-1')).toBe(true);
    });

    it('driver becomes ONLINE with no location on file yet: is not added (nothing to crash on)', async () => {
      await service.onAvailabilityChanged({
        ...baseline,
        lat: null,
        lng: null,
        locationUpdatedAt: null,
        previous: DriverAvailability.OFFLINE,
        availability: DriverAvailability.ONLINE,
      });

      expect(redis.geo.has('driver-1')).toBe(false);
    });

    it('driver becomes ONLINE with a stale existing location: is not added', async () => {
      await service.onAvailabilityChanged({
        ...baseline,
        locationUpdatedAt: new Date(Date.now() - 10 * 60 * 1000), // 10 min old
        previous: DriverAvailability.OFFLINE,
        availability: DriverAvailability.ONLINE,
      });

      expect(redis.geo.has('driver-1')).toBe(false);
    });

    it('driver becomes OFFLINE: is removed from the index', async () => {
      await service.upsert({
        driverUserId: 'driver-1',
        driverProfileId: 'profile-1',
        lat: LAGOS.lat,
        lng: LAGOS.lng,
        vehicleId: 'vehicle-1',
      });

      await service.onAvailabilityChanged({
        ...baseline,
        previous: DriverAvailability.ONLINE,
        availability: DriverAvailability.OFFLINE,
      });

      expect(redis.geo.has('driver-1')).toBe(false);
    });

    it('driver becomes ON_TRIP: is removed from the available-driver index', async () => {
      await service.upsert({
        driverUserId: 'driver-1',
        driverProfileId: 'profile-1',
        lat: LAGOS.lat,
        lng: LAGOS.lng,
        vehicleId: 'vehicle-1',
      });

      await service.onAvailabilityChanged({
        ...baseline,
        previous: DriverAvailability.ONLINE,
        availability: DriverAvailability.ON_TRIP,
      });

      expect(redis.geo.has('driver-1')).toBe(false);
    });

    it('driver becomes BREAK: is also removed (not a dispatch candidate)', async () => {
      await service.upsert({
        driverUserId: 'driver-1',
        driverProfileId: 'profile-1',
        lat: LAGOS.lat,
        lng: LAGOS.lng,
        vehicleId: 'vehicle-1',
      });

      await service.onAvailabilityChanged({
        ...baseline,
        previous: DriverAvailability.ONLINE,
        availability: DriverAvailability.BREAK,
      });

      expect(redis.geo.has('driver-1')).toBe(false);
    });

    it('driver returns ONLINE after a trip: is re-added using their latest fix', async () => {
      await service.onAvailabilityChanged({
        ...baseline,
        previous: DriverAvailability.ON_TRIP,
        availability: DriverAvailability.OFFLINE,
      });
      expect(redis.geo.has('driver-1')).toBe(false);

      await service.onAvailabilityChanged({
        ...baseline,
        previous: DriverAvailability.OFFLINE,
        availability: DriverAvailability.ONLINE,
      });
      expect(redis.geo.has('driver-1')).toBe(true);
    });
  });

  describe('driver.location.updated handling (GPS pings)', () => {
    it('GPS update while ONLINE and approved: registers/refreshes the driver', async () => {
      await service.onLocationUpdated({
        driverUserId: 'driver-1',
        lat: LAGOS.lat,
        lng: LAGOS.lng,
        at: new Date(),
        availability: DriverAvailability.ONLINE,
        approvalStatus: DriverApprovalStatus.APPROVED,
        driverProfileId: 'profile-1',
        vehicleId: 'vehicle-1',
      });

      expect(redis.geo.has('driver-1')).toBe(true);
    });

    it('GPS update while OFFLINE: is ignored, not indexed', async () => {
      await service.onLocationUpdated({
        driverUserId: 'driver-1',
        lat: LAGOS.lat,
        lng: LAGOS.lng,
        at: new Date(),
        availability: DriverAvailability.OFFLINE,
        approvalStatus: DriverApprovalStatus.APPROVED,
        driverProfileId: 'profile-1',
        vehicleId: 'vehicle-1',
      });

      expect(redis.geo.has('driver-1')).toBe(false);
    });

    it('GPS update while ON_TRIP: is ignored, not re-added to the available pool', async () => {
      await service.onLocationUpdated({
        driverUserId: 'driver-1',
        lat: LAGOS.lat,
        lng: LAGOS.lng,
        at: new Date(),
        availability: DriverAvailability.ON_TRIP,
        approvalStatus: DriverApprovalStatus.APPROVED,
        driverProfileId: 'profile-1',
        vehicleId: 'vehicle-1',
      });

      expect(redis.geo.has('driver-1')).toBe(false);
    });

    it('GPS update for a not-yet-approved driver: is ignored', async () => {
      await service.onLocationUpdated({
        driverUserId: 'driver-1',
        lat: LAGOS.lat,
        lng: LAGOS.lng,
        at: new Date(),
        availability: DriverAvailability.ONLINE,
        approvalStatus: DriverApprovalStatus.PENDING,
        driverProfileId: 'profile-1',
        vehicleId: 'vehicle-1',
      });

      expect(redis.geo.has('driver-1')).toBe(false);
    });

    it('reconnect: a fresh GPS ping re-registers a driver previously removed for staleness/offline', async () => {
      await service.onAvailabilityChanged({
        driverUserId: 'driver-1',
        driverProfileId: 'profile-1',
        vehicleId: 'vehicle-1',
        lat: LAGOS.lat,
        lng: LAGOS.lng,
        locationUpdatedAt: new Date(),
        previous: DriverAvailability.ONLINE,
        availability: DriverAvailability.OFFLINE,
      });
      expect(redis.geo.has('driver-1')).toBe(false);

      await service.onLocationUpdated({
        driverUserId: 'driver-1',
        lat: LAGOS.lat + 0.01,
        lng: LAGOS.lng + 0.01,
        at: new Date(),
        availability: DriverAvailability.ONLINE,
        approvalStatus: DriverApprovalStatus.APPROVED,
        driverProfileId: 'profile-1',
        vehicleId: 'vehicle-1',
      });

      expect(redis.geo.has('driver-1')).toBe(true);
    });
  });

  describe('searchNearby (stale GPS exclusion + candidate shape)', () => {
    it('excludes a driver whose metadata is older than the stale threshold', async () => {
      await service.upsert({
        driverUserId: 'fresh-driver',
        driverProfileId: 'p1',
        lat: LAGOS.lat,
        lng: LAGOS.lng,
        vehicleId: null,
      });
      await service.upsert({
        driverUserId: 'stale-driver',
        driverProfileId: 'p2',
        lat: LAGOS.lat + 0.001,
        lng: LAGOS.lng + 0.001,
        vehicleId: null,
        updatedAt: Date.now() - 10 * 60 * 1000, // 10 minutes old, threshold is 120s
      });

      const candidates = await service.searchNearby(LAGOS, 5);

      const ids = candidates.map((c) => c.driverUserId);
      expect(ids).toContain('fresh-driver');
      expect(ids).not.toContain('stale-driver');
    });

    it('returns candidates sorted nearest-first with distance populated', async () => {
      await service.upsert({
        driverUserId: 'far',
        driverProfileId: 'p1',
        lat: LAGOS.lat + 0.05,
        lng: LAGOS.lng + 0.05,
        vehicleId: null,
      });
      await service.upsert({
        driverUserId: 'near',
        driverProfileId: 'p2',
        lat: LAGOS.lat + 0.001,
        lng: LAGOS.lng + 0.001,
        vehicleId: null,
      });

      const candidates = await service.searchNearby(LAGOS, 20);

      expect(candidates[0].driverUserId).toBe('near');
      expect(candidates[0].distanceKm).toBeLessThan(candidates[1].distanceKm);
    });

    it('excludes a geo member whose metadata hash is missing entirely (orphaned entry)', async () => {
      redis.geo.set('orphan', { lon: LAGOS.lng, lat: LAGOS.lat });

      const candidates = await service.searchNearby(LAGOS, 5);

      expect(candidates.map((c) => c.driverUserId)).not.toContain('orphan');
    });
  });

  describe('Redis failure handling', () => {
    it('upsert() swallows a Redis failure instead of throwing', async () => {
      redis.failNext = true;
      await expect(
        service.upsert({
          driverUserId: 'driver-1',
          driverProfileId: 'profile-1',
          lat: LAGOS.lat,
          lng: LAGOS.lng,
          vehicleId: null,
        }),
      ).resolves.toBeUndefined();
    });

    it('remove() swallows a Redis failure instead of throwing', async () => {
      redis.failNext = true;
      await expect(service.remove('driver-1')).resolves.toBeUndefined();
    });

    it('searchNearby() returns an empty array instead of throwing when Redis is down', async () => {
      redis.failNext = true;
      await expect(service.searchNearby(LAGOS, 5)).resolves.toEqual([]);
    });

    it('refreshAvailableDriverCountMetric() swallows a Redis failure instead of throwing', async () => {
      redis.failNext = true;
      await expect(service.refreshAvailableDriverCountMetric()).resolves.toBeUndefined();
      expect(metrics.availableDriverCount.set).not.toHaveBeenCalled();
    });
  });

  describe('observability (batch 9)', () => {
    it('counts every location-updated event, even ones that end up filtered out (not ONLINE/approved)', async () => {
      await service.onLocationUpdated({
        driverUserId: 'driver-1',
        lat: LAGOS.lat,
        lng: LAGOS.lng,
        at: new Date(),
        availability: DriverAvailability.OFFLINE, // filtered out below the counter
        approvalStatus: DriverApprovalStatus.APPROVED,
        driverProfileId: 'profile-1',
        vehicleId: null,
      });

      expect(metrics.driverLocationUpdatesTotal.inc).toHaveBeenCalledTimes(1);
      // Confirms it really was filtered out — not indexed despite being counted.
      expect(await service.searchNearby(LAGOS, 5)).toEqual([]);
    });

    it('refreshAvailableDriverCountMetric() samples the geo index size via ZCARD, not a Postgres scan', async () => {
      await service.upsert({ driverUserId: 'a', driverProfileId: 'p-a', lat: LAGOS.lat, lng: LAGOS.lng, vehicleId: null });
      await service.upsert({ driverUserId: 'b', driverProfileId: 'p-b', lat: LAGOS.lat, lng: LAGOS.lng, vehicleId: null });

      await service.refreshAvailableDriverCountMetric();

      expect(metrics.availableDriverCount.set).toHaveBeenCalledWith(2);
    });
  });
});
