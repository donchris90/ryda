import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
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

  /** Driver explicitly declines their offer — the passenger picks someone else themselves, no automatic reassignment. */
  async markDeclined(rideId: string, driverUserId: string): Promise<void> {
    await this.offersRepo.update(
      { rideId, driverUserId, status: RideOfferStatus.PENDING },
      { status: RideOfferStatus.DECLINED },
    );
  }

  /**
   * The passenger's explicit choice, not a ranking decision — no
   * "nearest eligible" logic here, this driver is who they picked.
   * Supersedes any existing pending offer for this ride first (from an
   * earlier selection that expired or was declined), so there's always
   * at most one live offer per ride — the exclusivity check in
   * RidesService.acceptRide() depends on that invariant holding.
   */
  async offerToSpecificDriver(rideId: string, driverUserId: string): Promise<RideOffer> {
    await this.offersRepo.update(
      { rideId, status: RideOfferStatus.PENDING },
      { status: RideOfferStatus.SUPERSEDED },
    );

    const ride = await this.ridesRepo.findOne({ where: { id: rideId } });
    let distanceKm = 0;
    if (ride) {
      const candidates = await this.driversService.findNearby(
        { lat: ride.pickupLat, lng: ride.pickupLng },
        { limit: 20 },
      );
      distanceKm = candidates.find((c) => c.userId === driverUserId)?.distanceKm ?? 0;
    }

    const timeoutSeconds = this.config.get<number>('dispatch.offerTimeoutSeconds')!;
    const offer = await this.offersRepo.save(
      this.offersRepo.create({
        rideId,
        driverUserId,
        distanceKm,
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
      distanceKm,
      timeoutSeconds,
    });
    this.metricsService.dispatchOffersTotal.inc();

    return offer;
  }

  async getMyPendingOffer(rideId: string, driverUserId: string): Promise<RideOffer | null> {
    return this.offersRepo.findOne({
      where: { rideId, driverUserId, status: RideOfferStatus.PENDING },
    });
  }

  /** Used by RidesService.acceptRide()'s exclusivity check — is *anyone* currently offered this ride, and who. */
  async getPendingOfferForRide(rideId: string): Promise<RideOffer | null> {
    return this.offersRepo.findOne({
      where: { rideId, status: RideOfferStatus.PENDING },
    });
  }

  /** Exposed for the health check — confirms the scheduler is actually still running, not just registered. */
  lastSweepAt: Date | null = null;

  /**
   * Periodic sweep: expires offers past their deadline. Used to
   * auto-reassign to the next-nearest driver here too — that's exactly
   * the "system silently picks a different driver instead of the
   * passenger" behavior this feature was rebuilt to remove. Now it only
   * does the expiry bookkeeping; the passenger's app polls/detects the
   * expired offer and shows them the driver list again to choose
   * themselves.
   */
  @Interval(15000)
  async expireStaleOffersAndReassign(): Promise<void> {
    this.lastSweepAt = new Date();

    const stale = await this.offersRepo.find({
      where: { status: RideOfferStatus.PENDING, expiresAt: LessThan(new Date()) },
    });
    if (stale.length === 0) return;

    for (const offer of stale) {
      offer.status = RideOfferStatus.EXPIRED;
    }
    await this.offersRepo.save(stale);
  }
}
