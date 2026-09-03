/**
 * Haversine distance in km between two lat/lng points. Good enough for fare
 * estimates and proximity dispatch; swap for a routing-engine call
 * (Google/Mapbox) where actual road distance matters.
 */
export function haversineDistanceKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

// Same figure ranking.service.ts's DriverRankingService already used
// privately - centralized here so a second caller (dispatch.service.ts,
// estimating an ETA to show a driver on their ride offer) doesn't have
// to duplicate or drift from it.
export const FALLBACK_AVERAGE_SPEED_KMH = 28;

/**
 * Distance / assumed average speed - explicitly a fallback, not a
 * routing estimate. Callers that also track an "eta source" concept
 * (see EtaSource.FALLBACK_DISTANCE in ranking.types.ts) should label
 * results from this the same way, so nothing downstream mistakes it
 * for a real road ETA.
 */
export function fallbackEtaMinutes(distanceKm: number, avgSpeedKmh = FALLBACK_AVERAGE_SPEED_KMH): number {
  const hours = distanceKm / avgSpeedKmh;
  return Math.round(hours * 60);
}
