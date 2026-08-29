import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import Redis from 'ioredis';
import { LIVE_DRIVER_REDIS_CLIENT } from './live-driver-redis.provider';
import { RydaRedisKeys } from './redis-keys';
import {
  DriverAvailability,
  DriverApprovalStatus,
  isOnlineAvailability,
} from '../common/enums/driver-status.enum';
import { MetricsService } from '../observability/metrics.service';

export interface LiveDriverUpsertInput {
  driverUserId: string;
  driverProfileId: string;
  lat: number;
  lng: number;
  vehicleId: string | null;
  /** Epoch ms this fix was captured. Defaults to now. */
  updatedAt?: number;
}

export interface LiveDriverCandidate {
  driverUserId: string;
  driverProfileId: string;
  vehicleId: string | null;
  lat: number;
  lng: number;
  updatedAtMs: number;
  distanceKm: number;
}

/** Payload shape emitted by DriversService.updateLocation(). */
interface DriverLocationUpdatedEvent {
  driverUserId: string;
  lat: number;
  lng: number;
  at: Date;
  availability?: DriverAvailability;
  approvalStatus?: DriverApprovalStatus;
  driverProfileId?: string;
  vehicleId?: string | null;
}

/** Payload shape emitted by DriversService.setAvailability(). */
interface DriverAvailabilityChangedEvent {
  driverUserId: string;
  driverProfileId: string;
  previous: DriverAvailability;
  availability: DriverAvailability;
  vehicleId: string | null;
  /** Last known fix at the moment of the transition, if any. */
  lat: number | null;
  lng: number | null;
  locationUpdatedAt: Date | null;
}

/**
 * The single shared "who's live and where" index — Redis GEO for position,
 * a companion hash per driver for freshness/metadata. This is intentionally
 * thin: it knows about location + freshness + which vehicle a driver is
 * currently driving, nothing about ride vs courier eligibility, vehicle
 * *category* matching, or ranking. Those stay in the candidate-search and
 * ranking layers built on top of this (kept separate deliberately — see
 * requirement 14 in the batch 2 spec).
 *
 * Every public method is best-effort: a Redis outage degrades dispatch
 * (candidates come back empty) rather than taking the API down or
 * corrupting durable data. PostgreSQL's driver_profiles table remains the
 * durable source of truth for online/offline/on-trip state and the latest
 * known location; this index is a disposable, rebuildable cache of that —
 * see onLocationUpdated()/onAvailabilityChanged() below for how it
 * resynchronizes itself from the events PostgreSQL-backed writes already
 * emit.
 */
@Injectable()
export class LiveDriverIndexService {
  private readonly logger = new Logger(LiveDriverIndexService.name);
  private readonly staleMs: number;

  constructor(
    @Inject(LIVE_DRIVER_REDIS_CLIENT) private readonly redis: Redis,
    private readonly config: ConfigService,
    private readonly metrics: MetricsService,
  ) {
    const staleSeconds =
      this.config.get<number>('driverLocation.staleSeconds') ?? 120;
    this.staleMs = staleSeconds * 1000;
  }

  /**
   * Periodic, cheap sample of how many drivers are currently live and
   * dispatchable — a single Redis ZCARD, not a Postgres scan. Called on
   * an interval from LiveDriverIndexModule rather than recomputed on
   * every read, since candidate searches already happen far more often
   * than this gauge needs to move.
   */
  async refreshAvailableDriverCountMetric(): Promise<void> {
    try {
      const count = await this.redis.zcard(RydaRedisKeys.liveDriverGeoIndex());
      this.metrics.availableDriverCount.set(count);
    } catch (err) {
      this.logger.error(
        `Failed to sample available-driver count: ${(err as Error).message}`,
      );
    }
  }

  /** Add or refresh a driver's position in the live index. */
  async upsert(entry: LiveDriverUpsertInput): Promise<void> {
    if (!this.isFiniteCoordinate(entry.lat, entry.lng)) {
      this.logger.warn(
        `Refusing to index non-finite coordinate for driver ${entry.driverUserId}`,
      );
      return;
    }
    const updatedAt = entry.updatedAt ?? Date.now();
    try {
      const pipeline = this.redis.pipeline();
      pipeline.geoadd(
        RydaRedisKeys.liveDriverGeoIndex(),
        entry.lng,
        entry.lat,
        entry.driverUserId,
      );
      pipeline.hset(RydaRedisKeys.liveDriverMeta(entry.driverUserId), {
        driverProfileId: entry.driverProfileId,
        vehicleId: entry.vehicleId ?? '',
        updatedAt: String(updatedAt),
      });
      await pipeline.exec();
    } catch (err) {
      // Redis is a cache here, not a system of record — a failed write
      // just means this driver is temporarily invisible to dispatch, not
      // a data-loss event. Swallow and log rather than throwing back into
      // whatever event handler / request triggered this.
      this.logger.error(
        `Failed to upsert live-driver index entry for ${entry.driverUserId}: ${(err as Error).message}`,
      );
    }
  }

  /** Remove a driver from the live index (offline, on-trip, or reserved). */
  async remove(driverUserId: string): Promise<void> {
    try {
      const pipeline = this.redis.pipeline();
      pipeline.zrem(RydaRedisKeys.liveDriverGeoIndex(), driverUserId);
      pipeline.del(RydaRedisKeys.liveDriverMeta(driverUserId));
      await pipeline.exec();
    } catch (err) {
      this.logger.error(
        `Failed to remove driver ${driverUserId} from live-driver index: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Raw geospatial candidate lookup — position + freshness only, no
   * eligibility/vehicle-category/availability-in-Postgres filtering. That
   * happens one layer up, in the shared candidate-search engine. Drivers
   * whose freshness metadata is missing or older than the configured
   * stale threshold are excluded here rather than returned for the caller
   * to filter, since "don't dispatch to a driver with dead GPS" is a
   * property of the index itself, not a business rule that varies by
   * service.
   */
  async searchNearby(
    center: { lat: number; lng: number },
    radiusKm: number,
    limit = 50,
  ): Promise<LiveDriverCandidate[]> {
    let raw: Array<[string, string, [string, string]]>;
    try {
      raw = (await this.redis.geosearch(
        RydaRedisKeys.liveDriverGeoIndex(),
        'FROMLONLAT',
        center.lng,
        center.lat,
        'BYRADIUS',
        radiusKm,
        'km',
        'ASC',
        'COUNT',
        limit,
        'WITHCOORD',
        'WITHDIST',
      )) as unknown as Array<[string, string, [string, string]]>;
    } catch (err) {
      this.logger.error(
        `Live-driver GEOSEARCH failed, returning no candidates: ${(err as Error).message}`,
      );
      return [];
    }

    if (!raw.length) return [];

    let metaResults: Array<[Error | null, unknown]>;
    try {
      const pipeline = this.redis.pipeline();
      for (const [driverUserId] of raw) {
        pipeline.hgetall(RydaRedisKeys.liveDriverMeta(driverUserId));
      }
      metaResults = (await pipeline.exec()) ?? [];
    } catch (err) {
      this.logger.error(
        `Failed to fetch live-driver metadata, returning no candidates: ${(err as Error).message}`,
      );
      return [];
    }

    const now = Date.now();
    const candidates: LiveDriverCandidate[] = [];

    raw.forEach(([driverUserId, distanceStr, coords], index) => {
      const [, meta] = metaResults[index] ?? [null, undefined];
      const metaHash = meta as Record<string, string> | undefined;

      // No metadata at all means this member is orphaned (e.g. the geo
      // entry survived a partial failure that deleted the hash) — treat
      // as absent rather than guessing at freshness.
      if (!metaHash || !metaHash.updatedAt) return;

      const updatedAtMs = parseInt(metaHash.updatedAt, 10);
      if (!Number.isFinite(updatedAtMs) || now - updatedAtMs > this.staleMs)
        return;

      candidates.push({
        driverUserId,
        driverProfileId: metaHash.driverProfileId ?? '',
        vehicleId: metaHash.vehicleId || null,
        lng: parseFloat(coords[0]),
        lat: parseFloat(coords[1]),
        updatedAtMs,
        distanceKm: parseFloat(distanceStr),
      });
    });

    return candidates;
  }

  /**
   * Fresh GPS ping. Only online, approved drivers get (re-)indexed — a
   * ping that arrives just after a driver goes on-trip or offline is
   * intentionally ignored here rather than re-adding them; the
   * availability-changed handler below is the one source of truth for
   * add/remove on a state transition, so this can't race it.
   */
  @OnEvent('driver.location.updated')
  async onLocationUpdated(payload: DriverLocationUpdatedEvent): Promise<void> {
    // Counted for every GPS ping this service hears about, regardless of
    // whether it goes on to be indexed below — driver_location_updates
    // is meant to reflect real-world ping volume, not just the subset
    // that happened to be from an online, approved driver.
    this.metrics.driverLocationUpdatesTotal.inc();

    if (!isOnlineAvailability(payload.availability)) return;
    if (payload.approvalStatus !== DriverApprovalStatus.APPROVED) return;
    if (!payload.driverProfileId) return;

    await this.upsert({
      driverUserId: payload.driverUserId,
      driverProfileId: payload.driverProfileId,
      lat: payload.lat,
      lng: payload.lng,
      vehicleId: payload.vehicleId ?? null,
      updatedAt: payload.at instanceof Date ? payload.at.getTime() : Date.now(),
    });
  }

  /**
   * Availability transition (any of the online-for-X states, OFFLINE,
   * ON_TRIP, or BREAK). Going online (including a driver reconnecting
   * after being offline) adds them using whatever location is already
   * on file, provided it isn't itself stale — a driver who goes online
   * with a location last reported 10 minutes ago shouldn't appear as a
   * candidate until their next real GPS ping arrives via
   * onLocationUpdated() above. Every other state removes them: on-trip
   * and break drivers should not be dispatch candidates, same as
   * offline ones. Which *service* they're online for is deliberately
   * not filtered here — that's CandidateSearchService's job; this
   * index only knows "reachable at all" vs not.
   */
  @OnEvent('driver.availability.changed')
  async onAvailabilityChanged(
    payload: DriverAvailabilityChangedEvent,
  ): Promise<void> {
    if (!isOnlineAvailability(payload.availability)) {
      await this.remove(payload.driverUserId);
      return;
    }

    if (
      payload.lat == null ||
      payload.lng == null ||
      !payload.locationUpdatedAt ||
      Date.now() - new Date(payload.locationUpdatedAt).getTime() > this.staleMs
    ) {
      // Nothing fresh to index yet. Not an error — the next location
      // ping (within 15s in practice, per the driver app's polling
      // interval) will register them via onLocationUpdated().
      return;
    }

    await this.upsert({
      driverUserId: payload.driverUserId,
      driverProfileId: payload.driverProfileId,
      lat: payload.lat,
      lng: payload.lng,
      vehicleId: payload.vehicleId,
      updatedAt: new Date(payload.locationUpdatedAt).getTime(),
    });
  }

  private isFiniteCoordinate(lat: number, lng: number): boolean {
    return Number.isFinite(lat) && Number.isFinite(lng);
  }

  /**
   * Single-driver raw index lookup — used only by the admin dispatch
   * diagnostic endpoint (requirement: "Why is driver X not available
   * for courier matching at pickup Y?"). Deliberately separate from
   * searchNearby(): that method silently drops a driver whose GPS is
   * stale or whose metadata is missing, which is exactly the
   * information a diagnostic needs to surface rather than hide.
   */
  async getEntry(driverUserId: string): Promise<{
    indexed: boolean;
    lat: number | null;
    lng: number | null;
    updatedAtMs: number | null;
    gpsFreshMs: number | null;
    isFresh: boolean;
    vehicleId: string | null;
  }> {
    try {
      const [meta, position] = await Promise.all([
        this.redis.hgetall(RydaRedisKeys.liveDriverMeta(driverUserId)),
        this.redis.geopos(RydaRedisKeys.liveDriverGeoIndex(), driverUserId),
      ]);

      const hasMeta = meta && Object.keys(meta).length > 0;
      const coords = position?.[0];
      const updatedAtMs =
        hasMeta && meta.updatedAt ? parseInt(meta.updatedAt, 10) : null;
      const gpsFreshMs =
        updatedAtMs != null && Number.isFinite(updatedAtMs)
          ? Date.now() - updatedAtMs
          : null;

      return {
        indexed: !!hasMeta && !!coords,
        lat: coords ? parseFloat(coords[1]) : null,
        lng: coords ? parseFloat(coords[0]) : null,
        updatedAtMs,
        gpsFreshMs,
        isFresh: gpsFreshMs != null && gpsFreshMs <= this.staleMs,
        vehicleId: hasMeta ? meta.vehicleId || null : null,
      };
    } catch (err) {
      this.logger.error(
        `Failed to read live-driver index entry for ${driverUserId}: ${(err as Error).message}`,
      );
      return {
        indexed: false,
        lat: null,
        lng: null,
        updatedAtMs: null,
        gpsFreshMs: null,
        isFresh: false,
        vehicleId: null,
      };
    }
  }
}
