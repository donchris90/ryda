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

  /** Driver explicitly declines their offer — immediately tries the next-nearest driver. */
  async markDeclined(rideId: string, driverUserId: string): Promise<void> {
    await this.offersRepo.update(
      { rideId, driverUserId, status: RideOfferStatus.PENDING },
      { status: RideOfferStatus.DECLINED },
    );
    await this.offerToNearestDriver(rideId);
  }

  async getMyPendingOffer(rideId: string, driverUserId: string): Promise<RideOffer | null> {
    return this.offersRepo.findOne({
      where: { rideId, driverUserId, status: RideOfferStatus.PENDING },
    });
  }

  /** Exposed for the health check — confirms the scheduler is actually still running, not just registered. */
  lastSweepAt: Date | null = null;

  /**
   * Periodic sweep: expires offers past their deadline and, for any ride
   * that's still searching, immediately tries the next-nearest driver.
   * This is what makes reassignment automatic rather than requiring the
   * driver to actively decline.
   */
  @Interval(15000)
  async expireStaleOffersAndReassign(): Promise<void> {
    this.lastSweepAt = new Date();

    const stale = await this.offersRepo.find({
      where: { status: RideOfferStatus.PENDING, expiresAt: LessThan(new Date()) },
    });
    if (stale.length === 0) return;

    const rideIds = new Set<string>();
    for (const offer of stale) {
      offer.status = RideOfferStatus.EXPIRED;
      rideIds.add(offer.rideId);
    }
    await this.offersRepo.save(stale);

    for (const rideId of rideIds) {
      await this.offerToNearestDriver(rideId);
    }
  }
}
