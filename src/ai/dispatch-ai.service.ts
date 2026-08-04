import { Injectable } from '@nestjs/common';
import { NearbyDriverResult } from '../drivers/drivers.service';
import { DriverLevel } from '../common/enums/driver-level.enum';

export interface ScoredDriver extends NearbyDriverResult {
  score: number;
}

const LEVEL_WEIGHT: Record<DriverLevel, number> = {
  [DriverLevel.ROOKIE]: 0,
  [DriverLevel.STANDARD]: 1,
  [DriverLevel.SILVER]: 2,
  [DriverLevel.GOLD]: 3,
  [DriverLevel.PLATINUM]: 4,
  [DriverLevel.DIAMOND]: 5,
  [DriverLevel.ELITE]: 6,
};

/**
 * Ranks candidate drivers by a weighted combination of proximity, rating,
 * and level — not just "nearest wins." A closer-but-lower-rated driver can
 * still lose to a slightly farther, well-established one. Weights are
 * simple and tunable, not learned from data.
 */
@Injectable()
export class DispatchAiService {
  rankDrivers(candidates: NearbyDriverResult[]): ScoredDriver[] {
    return candidates
      .map((candidate) => ({
        ...candidate,
        score: this.score(candidate),
      }))
      .sort((a, b) => b.score - a.score);
  }

  private score(candidate: NearbyDriverResult): number {
    // Closer is better — inverse distance, capped so a very close driver
    // doesn't dominate every other factor entirely.
    const proximityScore = Math.min(10, 10 / Math.max(0.1, candidate.distanceKm));
    const ratingScore = candidate.rating * 2; // 0-10 range for a 0-5 rating
    const levelScore = LEVEL_WEIGHT[candidate.level] ?? 0;

    return proximityScore * 0.5 + ratingScore * 0.35 + levelScore * 0.15;
  }
}
