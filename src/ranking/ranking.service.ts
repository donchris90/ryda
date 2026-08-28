import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleMapsService, DirectionsResult } from '../maps/google-maps.service';
import { MetricsService } from '../observability/metrics.service';
import { CandidateResult } from '../candidate-search/candidate-search.types';
import { EtaSource, RankedCandidate, RankingOutcome } from './ranking.types';

/**
 * Ranks an already-eligible candidate pool by road ETA. This is
 * deliberately a thin, swappable layer — CandidateSearchService decides
 * *who's eligible*, this decides *what order to try them in*, and nothing
 * else in the dispatch pipeline needs to know how the ordering was
 * computed. Adding a second ranking factor later (driver idle time,
 * acceptance-rate weighting, etc.) means changing the sort inside rank()
 * without touching anything upstream or downstream of it.
 */
@Injectable()
export class DriverRankingService {
  private readonly logger = new Logger(DriverRankingService.name);

  // Matches the straight-line ETA heuristic RidesService.findSelectableDrivers()
  // already uses elsewhere in the codebase, so the fallback here doesn't
  // introduce a second, inconsistent guess at average city driving speed.
  private static readonly FALLBACK_AVERAGE_SPEED_KMH = 28;

  constructor(
    private readonly googleMaps: GoogleMapsService,
    private readonly config: ConfigService,
    private readonly metrics: MetricsService,
  ) {}

  /**
   * @param pickup Where the ranked ETA is measured *to* — the ride/delivery pickup point.
   * @param candidates Eligible candidates from CandidateSearchService, expected pre-sorted by straight-line distance (closest first) — that ordering is what determines which ones make the routing shortlist below.
   */
  async rank(pickup: { lat: number; lng: number }, candidates: CandidateResult[]): Promise<RankingOutcome> {
    this.metrics.rankingCandidateCount.observe(candidates.length);

    if (candidates.length === 0) {
      this.metrics.rankingRankedCount.observe(0);
      return { ranked: [], routingCallsMade: 0, routingFailures: 0, fallbackUsed: false };
    }

    const etaCandidateLimit = this.config.get<number>('dispatch.etaCandidateLimit') ?? 8;

    // COST REQUIREMENT: never call the routing API once per candidate.
    // Candidates already arrive distance-sorted, so the closest N are the
    // only ones a routing call could plausibly change the outcome for —
    // a driver ranked 40th by straight-line distance isn't going to beat
    // the top 8 on road ETA in practice, and if it somehow did, the cost
    // of checking every single online driver isn't worth that edge case.
    const shortlisted = candidates.slice(0, etaCandidateLimit);
    const skipped = candidates.slice(etaCandidateLimit);

    let routingCallsMade = 0;
    let routingFailures = 0;
    let fallbackUsed = false;

    const rankedShortlist: RankedCandidate[] = await Promise.all(
      shortlisted.map(async (candidate) => {
        routingCallsMade += 1;
        const stopTimer = this.metrics.etaCalculationDurationSeconds.startTimer();
        let directions: DirectionsResult | null = null;
        try {
          directions = await this.googleMaps.getDirections({ lat: candidate.lat, lng: candidate.lng }, pickup);
        } catch (err) {
          // GoogleMapsService.getDirections() already catches its own
          // failures and resolves null — this catch is belt-and-braces
          // in case that contract ever changes. Ranking must never throw
          // because a routing call misbehaved.
          this.logger.warn(
            `Unexpected error calling routing API for driver ${candidate.driverUserId}: ${(err as Error).message}`,
          );
        } finally {
          stopTimer();
        }

        if (directions) {
          return { ...candidate, etaMinutes: directions.durationMin, etaSource: EtaSource.ROUTING };
        }

        routingFailures += 1;
        fallbackUsed = true;
        this.metrics.rankingRoutingFailuresTotal.inc();
        this.logger.warn(
          `Routing ETA unavailable for driver ${candidate.driverUserId} — using distance-based fallback, not treating it as a real routing result`,
        );

        return {
          ...candidate,
          etaMinutes: this.fallbackEtaMinutes(candidate.distanceKm),
          etaSource: EtaSource.FALLBACK_DISTANCE,
        };
      }),
    );

    // Candidates beyond the ETA shortlist were never routed — they still
    // get a ranked entry (so a caller with a very small eligible pool
    // isn't silently missing drivers), just always via the fallback
    // formula, clearly labeled as such.
    const rankedSkipped: RankedCandidate[] = skipped.map((candidate) => ({
      ...candidate,
      etaMinutes: this.fallbackEtaMinutes(candidate.distanceKm),
      etaSource: EtaSource.FALLBACK_DISTANCE,
    }));
    if (rankedSkipped.length > 0) fallbackUsed = true;

    const ranked = [...rankedShortlist, ...rankedSkipped];

    ranked.sort((a, b) => {
      if (a.etaMinutes !== b.etaMinutes) return a.etaMinutes - b.etaMinutes;
      // Deterministic tie-break when ETAs land equal (common with the
      // fallback formula, which is a pure function of distance): fall
      // back to distance, then driver id, so ranking order never depends
      // on Promise.all completion order or object insertion order.
      if (a.distanceKm !== b.distanceKm) return a.distanceKm - b.distanceKm;
      return a.driverUserId.localeCompare(b.driverUserId);
    });

    if (fallbackUsed) {
      this.metrics.rankingFallbackUsedTotal.inc();
    }
    this.metrics.rankingRankedCount.observe(ranked.length);

    return { ranked, routingCallsMade, routingFailures, fallbackUsed };
  }

  /**
   * Distance / assumed average speed. This is explicitly a fallback, not
   * a routing estimate — every caller sees `etaSource: FALLBACK_DISTANCE`
   * alongside this number and dispatch logs must carry that label too, so
   * nothing downstream can mistake it for a real road ETA.
   */
  private fallbackEtaMinutes(distanceKm: number): number {
    const hours = distanceKm / DriverRankingService.FALLBACK_AVERAGE_SPEED_KMH;
    return Math.round(hours * 60);
  }
}
