import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { Ride } from '../rides/entities/ride.entity';
import { RideStatus } from '../common/enums/ride.enum';
import { CandidateSearchService } from '../candidate-search/candidate-search.service';
import { DispatchDomain, DispatchMode } from '../candidate-search/candidate-search.types';
import { DriverRankingService } from '../ranking/ranking.service';
import { DispatchService } from './dispatch.service';
import { MetricsService } from '../observability/metrics.service';

/**
 * Drives AUTOMATIC dispatch end-to-end, on top of the exact same shared
 * pipeline MANUAL selection uses — CandidateSearchService (Redis-backed
 * live driver index -> eligibility -> progressive radius) and
 * DriverRankingService (road-ETA ranking). This service owns none of that
 * matching logic itself; see candidate-search.types.ts's DispatchMode doc
 * comment for why AUTO must never grow a second, parallel search
 * implementation. All this file decides is *when* to call the shared
 * pipeline and *what to do with the result*:
 *
 *   ride created (AUTO) / scheduled ride activates
 *     -> offer to the best-ranked eligible candidate
 *     -> declined or timed out
 *        -> offer to the next best-ranked candidate, excluding every
 *           driver already tried for this ride (never re-offer the same
 *           driver twice for one ride)
 *     -> repeat, letting CandidateSearchService's own progressive-radius
 *        expansion widen the search only as far as needed, until:
 *          - a driver accepts — entirely RidesService.acceptRide()'s
 *            job, atomically reserved via reserveOnlineDriverForTrip();
 *            this file has no involvement in acceptance at all
 *          - the candidate pool is exhausted even at the configured max
 *            radius -> ride marked NO_DRIVER_FOUND
 *          - the ride leaves SEARCHING for any other reason (cancelled,
 *            accepted via the open broadcast-accept path, etc.) -> this
 *            re-checks ride state on every step rather than trusting its
 *            own view is still current, and just stops quietly
 */
@Injectable()
export class AutoDispatchService {
  private readonly logger = new Logger(AutoDispatchService.name);

  constructor(
    @InjectRepository(Ride) private readonly ridesRepo: Repository<Ride>,
    private readonly candidateSearchService: CandidateSearchService,
    private readonly driverRankingService: DriverRankingService,
    private readonly dispatchService: DispatchService,
    private readonly config: ConfigService,
    private readonly metrics: MetricsService,
  ) {}

  /**
   * Entry point after ride creation or scheduled-ride activation. Safe to
   * call unconditionally — internally no-ops for anything that isn't a
   * SEARCHING, AUTO-mode ride.
   */
  async startForRide(rideId: string): Promise<void> {
    await this.tryOfferNextCandidate(rideId, 'initial');
  }

  @OnEvent('ride.offer.declined')
  async onOfferDeclined(payload: { rideId: string; driverUserId: string }): Promise<void> {
    this.metrics.autoDispatchReassignmentsTotal.inc({ reason: 'declined' });
    await this.tryOfferNextCandidate(payload.rideId, 'declined');
  }

  @OnEvent('ride.offer.expired')
  async onOfferExpired(payload: { rideId: string; driverUserId: string }): Promise<void> {
    this.metrics.autoDispatchReassignmentsTotal.inc({ reason: 'expired' });
    await this.tryOfferNextCandidate(payload.rideId, 'expired');
  }

  private async tryOfferNextCandidate(rideId: string, trigger: string): Promise<void> {
    try {
      await this.offerNextCandidate(rideId);
    } catch (err) {
      // Must never let a bug here crash the request path, the periodic
      // sweep, or the event bus that called it. Worst case the ride
      // stays SEARCHING and the next decline/timeout/manual retry (or an
      // operator) gets another chance — that's a stuck ride, not a
      // crashed process or a silently double-assigned driver.
      this.logger.error(
        `AUTO dispatch step failed for ride ${rideId} (trigger=${trigger}): ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }

  private async offerNextCandidate(rideId: string): Promise<void> {
    const ride = await this.ridesRepo.findOne({ where: { id: rideId } });
    if (!ride) return;
    if (ride.status !== RideStatus.SEARCHING) return; // accepted, cancelled, already NO_DRIVER_FOUND, etc.
    if (ride.dispatchMode !== DispatchMode.AUTO) return; // never touches a MANUAL ride

    // Guards a decline and a near-simultaneous timeout both landing here
    // for the same ride: if a live offer already exists (created by the
    // other trigger a moment earlier, or by a concurrent invocation of
    // this same method), don't create a second one on top of it —
    // offerToSpecificDriver() would supersede it anyway, but that would
    // mean briefly offering, then un-offering, a driver for no reason.
    const existingOffer = await this.dispatchService.getPendingOfferForRide(rideId);
    if (existingOffer) return;

    const initialRadiusKm = this.config.get<number>('dispatch.initialRadiusKm') ?? 8;
    const maxRadiusKm = this.config.get<number>('dispatch.maxRadiusKm') ?? 15;
    const candidateFetchLimit = this.config.get<number>('dispatch.candidateFetchLimit') ?? 50;

    const excludeDriverUserIds = await this.dispatchService.getTriedDriverUserIds(rideId);

    const searchOutcome = await this.candidateSearchService.search({
      pickup: { lat: ride.pickupLat, lng: ride.pickupLng },
      domain: DispatchDomain.RIDE,
      mode: DispatchMode.AUTO,
      rideCategory: ride.category,
      requiresAccessibleVehicle: ride.requiresAccessibleVehicle,
      excludeDriverUserIds,
      minCandidates: 1,
      limit: candidateFetchLimit,
    });

    if (searchOutcome.radiusUsedKm > initialRadiusKm) {
      this.metrics.autoDispatchRadiusExpansionTotal.inc();
    }

    if (searchOutcome.candidates.length === 0) {
      // CandidateSearchService only ever stops expanding once it either
      // finds >=minCandidates (1, here) or its last configured round hits
      // maxRadiusKm — so an empty result always means the latter. Guarded
      // explicitly anyway rather than assuming that invariant forever.
      if (searchOutcome.radiusUsedKm >= maxRadiusKm) {
        await this.markNoDriverFound(ride);
      }
      return;
    }

    const rankingOutcome = await this.driverRankingService.rank(
      { lat: ride.pickupLat, lng: ride.pickupLng },
      searchOutcome.candidates,
    );
    const best = rankingOutcome.ranked[0];
    if (!best) return;

    await this.dispatchService.offerToSpecificDriver(rideId, best.driverUserId, best.distanceKm);
    this.metrics.autoDispatchOffersTotal.inc();

    this.logger.log(
      `AUTO offer: rideId=${rideId} dispatchMode=auto pickup=(${ride.pickupLat.toFixed(4)},${ride.pickupLng.toFixed(4)}) ` +
        `initialRadiusKm=${initialRadiusKm} finalRadiusKm=${searchOutcome.radiusUsedKm} candidateCount=${searchOutcome.candidates.length} ` +
        `selectedDriver=${best.driverUserId} selectionReason=best_road_eta(${best.etaMinutes}min,${best.etaSource}) triedBefore=${excludeDriverUserIds.length}`,
    );
  }

  /**
   * Ends AUTO dispatch for a ride whose candidate pool is exhausted even
   * at the configured max radius. Conditioned on `status = SEARCHING` in
   * the UPDATE itself (not just checked beforehand) so this can't clobber
   * a ride that got accepted or cancelled in the moment between this
   * method's read and write.
   */
  private async markNoDriverFound(ride: Ride): Promise<void> {
    const result = await this.ridesRepo
      .createQueryBuilder()
      .update(Ride)
      .set({ status: RideStatus.NO_DRIVER_FOUND })
      .where('id = :id', { id: ride.id })
      .andWhere('status = :searching', { searching: RideStatus.SEARCHING })
      .execute();

    if (result.affected === 1) {
      this.metrics.autoDispatchNoDriverFoundTotal.inc();
      this.logger.warn(
        `AUTO dispatch exhausted: rideId=${ride.id} dispatchMode=auto maxRadiusKm reached with no eligible driver — marked NO_DRIVER_FOUND`,
      );
    }
  }
}
