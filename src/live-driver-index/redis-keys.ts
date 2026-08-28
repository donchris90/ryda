/**
 * Centralized Redis key names for the shared live-driver geospatial index.
 *
 * Nothing outside this file should construct one of these keys by hand —
 * every consumer (LiveDriverIndexService today; the candidate-search engine,
 * ranking layer, and courier matching that build on top of it later) goes
 * through these builders instead. That's the whole point: one place to
 * change the naming scheme, one place to reason about what's actually in
 * Redis.
 *
 * Namespaced under `ryda:dispatch:` so this can share a Redis instance with
 * BullMQ (which namespaces its own keys under `bull:`) or anything else
 * without collisions.
 */
export const RydaRedisKeys = {
  /**
   * Single GEO sorted set holding every currently-online, approved driver
   * with a fresh GPS fix — ride and courier dispatch both read from this
   * same set. Members are driver **userId** (not driverProfileId), since
   * that's the id every other part of the system (events, offers, rides)
   * already keys off.
   */
  liveDriverGeoIndex(): string {
    return 'ryda:dispatch:live-drivers:geo';
  },

  /**
   * Per-driver metadata hash (freshness timestamp, profile id, active
   * vehicle id) — kept separate from the GEO set itself since GEO members
   * can only carry a score (the geohash), not arbitrary fields.
   */
  liveDriverMeta(driverUserId: string): string {
    return `ryda:dispatch:live-drivers:meta:${driverUserId}`;
  },
};
