import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { RideOffer, RideOfferStatus } from './entities/ride-offer.entity';
import { Ride } from '../rides/entities/ride.entity';
import { RideStatus } from '../common/enums/ride.enum';
import { DriversService } from '../drivers/drivers.service';
import { DispatchAiService } from '../ai/dispatch-ai.service';
import { FeatureFlagsService, FEATURE_KEYS } from '../feature-flags/feature-flags.service';
import { MetricsService } from '../observability/metrics.service';

/**
 * Adds a "smart dispatch" layer on top of the existing broadcast-accept
 * model (any online driver can still claim a searching ride via
 * PATCH /rides/:id/accept — that's unchanged and remains the authoritative
 * mechanism). This layer additionally targets the single nearest driver
 * first, gives them a time-limited offer, and automatically moves to the
 * next-nearest driver if they don't respond — closer to how production
 * dispatch actually works, without risking the existing tested flow.
 */
@Injectable()
export class DispatchService {
  private readonly logger = new Logger(DispatchService.name);

  constructor(
    @InjectRepository(RideOffer)
    private readonly offersRepo: Repository<RideOffer>,
    @InjectRepository(Ride)
    private readonly ridesRepo: Repository<Ride>,
    private readonly driversService: DriversService,
    private readonly dispatchAiService: DispatchAiService,
    private readonly featureFlagsService: FeatureFlagsService,
    private readonly config: ConfigService,
    private readonly events: EventEmitter2,
    private readonly metricsService: MetricsService,
  ) {}

  /**
   * Not called automatically anywhere anymore — the passenger picks a
   * driver themselves now (see rides.service.ts requestRide()). Left in
   * place, working and tested, as a real capability that could be wired
   * back in later — e.g. an "auto-assign for me" fallback button on the
   * driver-list screen, for a passenger who doesn't want to choose.
   *
   * Offers the ride to the nearest eligible driver who hasn't already been
   * tried for this ride (declined or timed out). No-ops quietly if nobody's
   * available — the ride stays "searching" and broadcast-accept still works.
   */
  async offerToNearestDriver(rideId: string): Promise<RideOffer | null> {
    const ride = await this.ridesRepo.findOne({ where: { id: rideId } });
    if (!ride || ride.status !== RideStatus.SEARCHING) return null;

    const alreadyTried = await this.offersRepo.find({ where: { rideId } });
    // Only an explicit decline (or accepted/superseded, kept for safety
    // though those states shouldn't coexist with a still-SEARCHING ride)
    // permanently rules a driver out. A merely EXPIRED offer does not —
    // the driver may never have actually seen it (this app's push
    // delivery is documented as unverified live, and the in-app
    // fallback is a 5s poll plus human reaction time against a default
    // 20s offer window). Treating expiry the same as a decline meant
    // that with only one nearby driver, a single missed notification
    // left the ride stuck in SEARCHING permanently — no driver left to
    // offer, no way to recover. Found by tracing exactly this symptom.
    const excludeUserIds = new Set(
      alreadyTried
        .filter((o) =>
          [RideOfferStatus.DECLINED, RideOfferStatus.ACCEPTED, RideOfferStatus.SUPERSEDED].includes(o.status),
        )
        .map((o) => o.driverUserId),
    );

    const radiusKm = this.config.get<number>('dispatch.offerRadiusKm')!;
    const candidates = await this.driversService.findNearby(
      { lat: ride.pickupLat, lng: ride.pickupLng },
      { city: ride.city ?? undefined, radiusKm, limit: 20 },
    );

    // Rank by a weighted score (proximity + rating + level), not pure
    // nearest-first — a closer but poorly-rated rookie can lose out to a
    // slightly farther, well-established driver. Toggleable via the
    // ai_dispatch feature flag without a redeploy — off falls back to the
    // plain distance-sorted order findNearby() already returns.
    const aiDispatchEnabled = await this.featureFlagsService.isEnabled(FEATURE_KEYS.AI_DISPATCH);
    const next = aiDispatchEnabled
      ? this.dispatchAiService.rankDrivers(candidates).find((c) => !excludeUserIds.has(c.userId))
      : candidates.find((c) => !excludeUserIds.has(c.userId));
    if (!next) {
      this.logger.debug(`No more eligible drivers to offer ride ${rideId} to`);
      return null;
    }

    const timeoutSeconds = this.config.get<number>('dispatch.offerTimeoutSeconds')!;
    const offer = await this.offersRepo.save(
      this.offersRepo.create({
        rideId,
        driverUserId: next.userId,
        distanceKm: next.distanceKm,
        expiresAt: new Date(Date.now() + timeoutSeconds * 1000),
      }),
    );

    this.events.emit('ride.offered', {
      driverUserId: next.userId,
      rideId,
      pickupAddress: ride.pickupAddress,
      distanceKm: next.distanceKm,
      timeoutSeconds,
    });
    this.metricsService.dispatchOffersTotal.inc();

    return offer;
  }

  /** Marks this driver's offer accepted and supersedes any other pending offers for the same ride. */
  async markAccepted(rideId: string, driverUserId: string): Promise<void> {
    await this.offersRepo.update(
      { rideId, driverUserId, status: RideOfferStatus.PENDING },
      { status: RideOfferStatus.ACCEPTED },
    );
    await this.offersRepo.update(
      { rideId, status: RideOfferStatus.PENDING },
      { status: RideOfferStatus.SUPERSEDED },
    );
  }

  /**
   * The passenger's "Choose someone else instead" needs a real backend
   * effect, not just a local UI state change — without this, the
   * driver they'd moved on from still had a genuinely pending offer
   * and could still accept the ride the passenger thought they'd
   * abandoned. Idempotent by design (updating zero rows if there's no
   * pending offer left) so it's safe to call even if the offer already
   * expired or was accepted moments before this fires.
   */
  async withdrawOffer(rideId: string): Promise<void> {
    await this.offersRepo.update(
      { rideId, status: RideOfferStatus.PENDING },
      { status: RideOfferStatus.SUPERSEDED },
    );
  }

  /**
   * Driver explicitly declines their offer. For a MANUAL ride this is the
   * end of it — the passenger picks someone else themselves, no automatic
   * reassignment. For an AUTO ride, AutoDispatchService listens for this
   * event and moves on to the next best-ranked candidate; this method
   * itself stays mode-agnostic and just does the bookkeeping + event, the
   * same as it always has.
   */
  async markDeclined(rideId: string, driverUserId: string): Promise<void> {
    const result = await this.offersRepo.update(
      { rideId, driverUserId, status: RideOfferStatus.PENDING },
      { status: RideOfferStatus.DECLINED },
    );
    if (result.affected) {
      this.events.emit('ride.offer.declined', { rideId, driverUserId });
    }
  }

  /**
   * All driver ids ever offered this ride, regardless of outcome
   * (pending/accepted/declined/expired/superseded). AutoDispatchService
   * uses this to build its exclude list so it never offers the same
   * driver twice for the same ride, satisfying "do not repeatedly select
   * the same driver" without AUTO needing its own tracking table.
   */
  async getTriedDriverUserIds(rideId: string): Promise<string[]> {
    const offers = await this.offersRepo.find({ where: { rideId } });
    return [...new Set(offers.map((o) => o.driverUserId))];
  }

  /**
   * The passenger's explicit choice, not a ranking decision — no
   * "nearest eligible" logic here, this driver is who they picked.
   * Supersedes any existing pending offer for this ride first (from an
   * earlier selection that expired or was declined), so there's always
   * at most one live offer per ride — the exclusivity check in
   * RidesService.acceptRide() depends on that invariant holding.
   *
   * Both current callers — MANUAL's RidesService.selectDriver() and
   * AUTO's AutoDispatchService — already have this driver's distance from
   * the shared CandidateSearchService result they just computed, so they
   * pass it in directly. `distanceKm` is only left optional, with the
   * legacy findNearby() scan as a fallback, for callers that predate the
   * shared pipeline; nothing on the current hot path should hit that scan.
   */
  async offerToSpecificDriver(rideId: string, driverUserId: string, distanceKm?: number): Promise<RideOffer> {
    await this.offersRepo.update(
      { rideId, status: RideOfferStatus.PENDING },
      { status: RideOfferStatus.SUPERSEDED },
    );

    const ride = await this.ridesRepo.findOne({ where: { id: rideId } });
    let resolvedDistanceKm = distanceKm;
    if (resolvedDistanceKm === undefined) {
      if (ride) {
        const candidates = await this.driversService.findNearby(
          { lat: ride.pickupLat, lng: ride.pickupLng },
          { limit: 20 },
        );
        resolvedDistanceKm = candidates.find((c) => c.userId === driverUserId)?.distanceKm ?? 0;
      } else {
        resolvedDistanceKm = 0;
      }
    }

    const timeoutSeconds = this.config.get<number>('dispatch.offerTimeoutSeconds')!;
    const offer = await this.offersRepo.save(
      this.offersRepo.create({
        rideId,
        driverUserId,
        distanceKm: resolvedDistanceKm,
        expiresAt: new Date(Date.now() + timeoutSeconds * 1000),
      }),
    );

    // This was missing entirely — the offer record itself was always
    // created correctly, which is why getMyPendingOffer() worked fine
    // in every earlier test, but nothing ever told the driver about
    // it. offerToNearestDriver() (the older, no-longer-primary path)
    // emits this same event; this method never did, since it was
    // built as a separate method rather than a variant of that one.
    // Whatever listens for 'ride.offered' (push notification dispatch,
    // in-app notification creation) never fired for a passenger-
    // selected offer, only for the old auto-assigned kind.
    this.events.emit('ride.offered', {
      driverUserId,
      rideId,
      pickupAddress: ride?.pickupAddress ?? '',
      distanceKm: resolvedDistanceKm,
      timeoutSeconds,
    });
    this.metricsService.dispatchOffersTotal.inc();

    return offer;
  }

  /**
   * A time-expired offer can still read status=PENDING for up to 15
   * seconds, until the periodic sweep catches up (see
   * expireStaleOffersAndReassign() below) - checking status alone
   * meant a driver could accept, or block another driver's
   * acceptance via the exclusivity check, using an offer that had
   * already genuinely expired. expiresAt is the actual source of
   * truth; status is just where the sweep's cleanup eventually lands.
   */
  private isLive(offer: RideOffer): boolean {
    return offer.status === RideOfferStatus.PENDING && offer.expiresAt.getTime() > Date.now();
  }

  async getMyPendingOffer(rideId: string, driverUserId: string): Promise<RideOffer | null> {
    const offer = await this.offersRepo.findOne({
      where: { rideId, driverUserId, status: RideOfferStatus.PENDING },
    });
    return offer && this.isLive(offer) ? offer : null;
  }

  /** Used by RidesService.acceptRide()'s exclusivity check — is *anyone* currently offered this ride, and who. */
  async getPendingOfferForRide(rideId: string): Promise<RideOffer | null> {
    const offer = await this.offersRepo.findOne({
      where: { rideId, status: RideOfferStatus.PENDING },
    });
    return offer && this.isLive(offer) ? offer : null;
  }

  /**
   * Distinguishes "this ride was never offered to anyone" (the old
   * broadcast-accept path should stay open) from "an offer existed but
   * is now dead — expired, withdrawn, or declined" (acceptance must be
   * blocked outright, for anyone, not just the driver whose offer it
   * was). Without this distinction, getPendingOfferForRide() correctly
   * returning null for a dead offer was being misread by acceptRide()
   * as "nobody's been offered this ride," silently falling through to
   * open acceptance — the exact driver whose own offer just expired
   * could still accept anyway.
   */
  async hasEverHadOffer(rideId: string): Promise<boolean> {
    const count = await this.offersRepo.count({ where: { rideId } });
    return count > 0;
  }

  /** Exposed for the health check — confirms the scheduler is actually still running, not just registered. */
  lastSweepAt: Date | null = null;

  /**
   * Periodic sweep: expires offers past their deadline. This method
   * itself only ever does the expiry bookkeeping — it deliberately does
   * NOT decide who to reassign to. What happens after an offer expires
   * depends entirely on the ride's own dispatchMode, and that decision
   * belongs to whoever owns that mode's behavior:
   *
   *   - MANUAL: nothing further happens here. The passenger's app
   *     polls/detects the expired offer and shows them the driver list
   *     again to choose themselves — silently picking a different driver
   *     for them is exactly the behavior this feature was rebuilt to
   *     remove (see the class doc comment above).
   *   - AUTO: AutoDispatchService listens for the 'ride.offer.expired'
   *     event emitted below and offers the ride to the next best-ranked
   *     candidate. It re-checks the ride's current status/dispatchMode
   *     itself before doing anything, so this sweep doesn't need to know
   *     which rides are AUTO — it just reports every expiry uniformly.
   *
   * This is one atomic conditional UPDATE, not a find-then-save round
   * trip. An earlier version read PENDING + time-expired rows, flipped
   * `.status` on the in-memory objects, then called save() — which is a
   * blind full-entity `UPDATE ... WHERE id = $1` with no guard on the
   * row's *current* status. In the window between that read and that
   * write, a driver's markAccepted() (or markDeclined()/withdrawOffer())
   * could land its own targeted `WHERE status = 'pending'` update on the
   * very same row — acceptRide() only requires the offer to have been
   * live at the moment it checked, which can be a moment before this
   * sweep's read. The old save() would then silently clobber that
   * genuine ACCEPTED/DECLINED/SUPERSEDED status back to EXPIRED, and
   * fire a bogus 'ride.offer.expired' for an offer that had actually
   * just been accepted — corrupting both the offer's own audit trail
   * and offer_timeout_rate's numerator below. Conditioning the UPDATE
   * itself on `status = PENDING` closes that window the same way every
   * other write in this file already does, and as a side effect also
   * makes two overlapping sweep ticks (if one ever runs past 15s) safe:
   * whichever's UPDATE commits first wins the row, the other's WHERE
   * simply matches nothing.
   */
  @Interval(15000)
  async expireStaleOffersAndReassign(): Promise<void> {
    this.lastSweepAt = new Date();

    const result = await this.offersRepo
      .createQueryBuilder()
      .update(RideOffer)
      .set({ status: RideOfferStatus.EXPIRED })
      .where('status = :pending', { pending: RideOfferStatus.PENDING })
      .andWhere('expiresAt < :now', { now: new Date() })
      .returning(['id', 'rideId', 'driverUserId'])
      .execute();

    const expired = (result.raw ?? []) as Array<{
      id: string;
      rideId: string;
      driverUserId: string;
    }>;
    if (expired.length === 0) return;

    // offer_timeout_rate (batch 9): every offer that times out unanswered,
    // MANUAL or AUTO alike — divide against dispatchOffersTotal in PromQL.
    // Only offers this UPDATE actually flipped are counted, so an offer
    // that was accepted/declined out from under the sweep in the same
    // instant is correctly excluded rather than double-counted.
    this.metricsService.dispatchOfferTimeoutsTotal.inc(expired.length);

    for (const offer of expired) {
      this.events.emit('ride.offer.expired', { rideId: offer.rideId, driverUserId: offer.driverUserId });
    }
  }
}
