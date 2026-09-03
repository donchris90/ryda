import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { haversineDistanceKm } from '../common/utils/geo.util';

const IMPOSSIBLE_SPEED_KMH = 250; // same threshold FraudService.checkGpsSpoof() uses, kept in sync deliberately

export interface LocationQualityAssessment {
  /**
   * Whether this reading should be applied as the driver's new live
   * position. False only for a genuine impossibility (an implied speed
   * no real vehicle can achieve) - every other issue below is
   * informational, not blocking, since rejecting a merely poor-quality
   * fix would leave the driver's position even more stale than
   * accepting it.
   */
  accept: boolean;
  /** Human-readable issues found, for logging - independent of accept/reject. */
  issues: string[];
  impliedSpeedKmh?: number;
}

@Injectable()
export class LocationQualityService {
  private readonly logger = new Logger(LocationQualityService.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * Assesses a single incoming GPS reading against the driver's last
   * known state. Pure function of its inputs - no I/O - so callers
   * decide what to do with the result (log, persist a duplicate-streak
   * counter, reject outright) rather than this service reaching into
   * the database itself.
   */
  assess(
    previous: { lat: number; lng: number; at: Date } | null,
    next: { lat: number; lng: number; accuracy?: number; fixTimestamp?: number },
    now: Date = new Date(),
  ): LocationQualityAssessment {
    const issues: string[] = [];

    const maxAccuracyMeters = this.config.get<number>('locationQuality.maxAccuracyMeters') ?? 100;
    if (next.accuracy != null && next.accuracy > maxAccuracyMeters) {
      issues.push(`poor_accuracy(${Math.round(next.accuracy)}m)`);
    }

    const maxFixAgeSeconds = this.config.get<number>('locationQuality.maxFixAgeSeconds') ?? 120;
    if (next.fixTimestamp != null) {
      const fixAgeSeconds = (now.getTime() - next.fixTimestamp) / 1000;
      // A negative age (fix "taken" in the future) is just as much a
      // red flag as a stale one - clock skew or a tampered payload,
      // either way it's worth logging.
      if (fixAgeSeconds > maxFixAgeSeconds || fixAgeSeconds < -30) {
        issues.push(`stale_fix(${Math.round(fixAgeSeconds)}s)`);
      }
    }

    let impliedSpeedKmh: number | undefined;
    let accept = true;

    if (previous) {
      const elapsedHours = (now.getTime() - previous.at.getTime()) / 3_600_000;
      if (elapsedHours > 0) {
        const distanceKm = haversineDistanceKm(previous.lat, previous.lng, next.lat, next.lng);
        impliedSpeedKmh = distanceKm / elapsedHours;

        if (impliedSpeedKmh > IMPOSSIBLE_SPEED_KMH) {
          issues.push(`impossible_speed(${Math.round(impliedSpeedKmh)}km/h)`);
          // A genuinely impossible jump must not become the driver's
          // live position - dispatch/ETA would immediately act on a
          // clearly-bogus location. FraudService.checkGpsSpoof() still
          // separately flags this for review; this is the "don't let
          // it corrupt live state" half of the same problem.
          accept = false;
        }
      }
    }

    if (issues.length > 0) {
      this.logger.warn(`Location quality issue(s): ${issues.join(', ')}${accept ? '' : ' — reading rejected'}`);
    }

    return { accept, issues, impliedSpeedKmh };
  }

  /**
   * Whether this coordinate exactly matches the previous one - callers
   * own the actual streak counter (a DB column) since that's stateful;
   * this just answers the single comparison.
   */
  isDuplicateOf(previous: { lat: number; lng: number } | null, next: { lat: number; lng: number }): boolean {
    if (!previous) return false;
    return previous.lat === next.lat && previous.lng === next.lng;
  }

  /** Whether a duplicate-coordinate streak of this length is worth logging - single source of truth for the configured threshold, so callers never need to know or hardcode it themselves. */
  isDuplicateStreakNotable(consecutiveCount: number): boolean {
    const threshold = this.config.get<number>('locationQuality.duplicateStreakThreshold') ?? 20;
    return consecutiveCount === threshold;
  }
}
