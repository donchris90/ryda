import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { GoogleMapsService, DirectionsResult } from '../maps/google-maps.service';
import { MetricsService } from '../observability/metrics.service';
import { CandidateResult } from '../candidate-search/candidate-search.types';
import { RideOffer, RideOfferStatus } from '../dispatch/entities/ride-offer.entity';
import { EtaSource, RankedCandidate, RankingOutcome } from './ranking.types';
import { fallbackEtaMinutes } from '../common/utils/geo.util';

/** Candidate shape before scoring runs - score/scoreBreakdown filled in afterward. */
type UnscoredCandidate = Omit<RankedCandidate, 'score' | 'scoreBreakdown'>;

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

  constructor(
    private readonly googleMaps: GoogleMapsService,
    private readonly config: ConfigService,
    private readonly metrics: MetricsService,
    @InjectRepository(RideOffer)
    private readonly offersRepo: Repository<RideOffer>,
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

    const rankedShortlist: UnscoredCandidate[] = await Promise.all(
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
          etaMinutes: fallbackEtaMinutes(candidate.distanceKm),
          etaSource: EtaSource.FALLBACK_DISTANCE,
        };
      }),
    );

    // Candidates beyond the ETA shortlist were never routed — they still
    // get a ranked entry (so a caller with a very small eligible pool
    // isn't silently missing drivers), just always via the fallback
    // formula, clearly labeled as such.
    const rankedSkipped: UnscoredCandidate[] = skipped.map((candidate) => ({
      ...candidate,
      etaMinutes: fallbackEtaMinutes(candidate.distanceKm),
      etaSource: EtaSource.FALLBACK_DISTANCE,
    }));
    if (rankedSkipped.length > 0) fallbackUsed = true;

    const ranked: RankedCandidate[] = [...rankedShortlist, ...rankedSkipped].map((c) => ({
      ...c,
      score: 0,
      scoreBreakdown: { etaScore: 0, ratingScore: 0, cancellationScore: 0, acceptanceScore: 0 },
    }));

    const acceptanceRateByDriver = await this.getAcceptanceRates(ranked.map((c) => c.driverUserId));
    const weights = this.config.get('dispatch.ranking') ?? {};
    const etaWeight = weights.etaWeight ?? 0.6;
    const ratingWeight = weights.ratingWeight ?? 0.2;
    const cancellationWeight = weights.cancellationWeight ?? 0.1;
    const acceptanceWeight = weights.acceptanceWeight ?? 0.1;
    const minTripsForCancellationSignal = weights.minTripsForCancellationSignal ?? 5;
    const minOffersForAcceptanceSignal = weights.minOffersForAcceptanceSignal ?? 5;

    for (const candidate of ranked) {
      // Bounded (0,1], never negative, never zero even for a very large
      // ETA - a smooth, simple normalization rather than an arbitrary
      // cutoff. Lower ETA -> score closer to 1.
      const etaScore = 1 / (1 + candidate.etaMinutes);

      // Ratings in this system are 0-5.
      const ratingScore = candidate.rating / 5;

      // "Do not unfairly discriminate against drivers" applies most
      // sharply here - a driver with only 1-2 trips shouldn't be
      // scored on a cancellation rate that's really just noise. Below
      // the configured minimum, treat as neutral (no penalty, no
      // bonus) rather than guessing from too little data.
      const cancellationScore =
        candidate.totalTrips < minTripsForCancellationSignal
          ? 1
          : 1 - candidate.cancelledTrips / candidate.totalTrips;

      const acceptance = acceptanceRateByDriver.get(candidate.driverUserId);
      const acceptanceScore =
        !acceptance || acceptance.decidedCount < minOffersForAcceptanceSignal
          ? 1
          : acceptance.acceptedCount / acceptance.decidedCount;

      candidate.score =
        etaWeight * etaScore +
        ratingWeight * ratingScore +
        cancellationWeight * cancellationScore +
        acceptanceWeight * acceptanceScore;
      candidate.scoreBreakdown = { etaScore, ratingScore, cancellationScore, acceptanceScore };
    }

    ranked.sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score; // higher score first
      // Deterministic tie-break when scores land equal: fall back to
      // ETA, then distance, then driver id, so ranking order never
      // depends on Promise.all completion order or object insertion
      // order.
      if (a.etaMinutes !== b.etaMinutes) return a.etaMinutes - b.etaMinutes;
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
   * One batched query for every candidate being ranked, not one query
   * per candidate - same cost discipline as the ETA/routing step above.
   * decidedCount excludes PENDING (no decision made yet) and SUPERSEDED
   * (the ride moved on for a reason unrelated to this driver's own
   * behavior, e.g. an admin cancelling the offer) - neither reflects
   * whether this driver actually accepted or turned down real offers.
   */
  private async getAcceptanceRates(
    driverUserIds: string[],
  ): Promise<Map<string, { acceptedCount: number; decidedCount: number }>> {
    const uniqueIds = [...new Set(driverUserIds)];
    if (uniqueIds.length === 0) return new Map();

    const rows = await this.offersRepo
      .createQueryBuilder('offer')
      .select('offer.driverUserId', 'driverUserId')
      .addSelect('offer.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('offer.driverUserId IN (:...ids)', { ids: uniqueIds })
      .andWhere('offer.status IN (:...statuses)', {
        statuses: [RideOfferStatus.ACCEPTED, RideOfferStatus.DECLINED, RideOfferStatus.EXPIRED],
      })
      .groupBy('offer.driverUserId')
      .addGroupBy('offer.status')
      .getRawMany<{ driverUserId: string; status: RideOfferStatus; count: string }>();

    const result = new Map<string, { acceptedCount: number; decidedCount: number }>();
    for (const row of rows) {
      const entry = result.get(row.driverUserId) ?? { acceptedCount: 0, decidedCount: 0 };
      const count = parseInt(row.count, 10);
      entry.decidedCount += count;
      if (row.status === RideOfferStatus.ACCEPTED) entry.acceptedCount += count;
      result.set(row.driverUserId, entry);
    }
    return result;
  }
}
