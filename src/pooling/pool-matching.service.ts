import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { Ride } from '../rides/entities/ride.entity';
import { RideStatus } from '../common/enums/ride.enum';
import { DispatchMode } from '../candidate-search/candidate-search.types';
import {
  PoolGroup,
  PoolGroupStatus,
  PoolRouteStop,
} from './entities/pool-group.entity';
import { AutoDispatchService } from '../dispatch/auto-dispatch.service';
import { MetricsService } from '../observability/metrics.service';
import { haversineDistanceKm } from '../common/utils/geo.util';

/**
 * Batch matching for pooled (shared) rides — the "Lyft Line / early
 * UberPool" style described in the product decision: a short wait
 * window, not a live-insertion-into-a-moving-car algorithm.
 *
 * Lifecycle of a pooled ride:
 *   1. RidesService.requestRide() creates it with status POOL_MATCHING
 *      instead of SEARCHING and calls requestPool() below.
 *   2. requestPool() immediately tries to pair it with any other
 *      compatible ride already waiting in POOL_MATCHING (no reason to
 *      make someone wait the full window if a partner already exists),
 *      then schedules a delayed job for the outer window as a
 *      fallback checkpoint.
 *   3. If paired (either path): a PoolGroup is created holding the
 *      chosen stop order, both rides move to SEARCHING carrying the
 *      same poolGroupId, a discount is applied to both fares, and only
 *      the "anchor" ride is handed to the existing
 *      CandidateSearch/AutoDispatch pipeline — completely unmodified.
 *      The partner ride's driver assignment is *propagated* onto it
 *      after acceptance (see RidesService.acceptRide()'s pool hook)
 *      rather than dispatched a second time.
 *   4. If the window expires unpaired: falls back to a normal solo
 *      AUTO ride at the full (undiscounted) fare it already has.
 *
 * Deliberate v1 simplifications, called out here rather than hidden:
 *   - Matching feasibility and the stored route both use haversine
 *     distance, not a routing-engine call — consistent with this
 *     codebase's existing "good enough for estimates/dispatch, not for
 *     the meter" treatment of haversine elsewhere (see geo.util.ts).
 *   - The discount is a flat fraction of each rider's solo fare, not
 *     weighted by how much overlap they actually got. A fairer
 *     overlap-weighted split is a natural v2 (the route data needed
 *     for it — perRideDistanceKm — is already computed here, just not
 *     used for pricing yet).
 *   - Only pairs (max 2 riders), per product decision — the ordering
 *     search below (`validOrderings`) is hardcoded for exactly 2 rides
 *     and would need generalizing before supporting 3+.
 */
@Injectable()
export class PoolMatchingService {
  private readonly logger = new Logger(PoolMatchingService.name);

  constructor(
    @InjectRepository(Ride) private readonly ridesRepo: Repository<Ride>,
    @InjectRepository(PoolGroup)
    private readonly poolGroupsRepo: Repository<PoolGroup>,
    @InjectQueue('pool-matching') private readonly poolMatchingQueue: Queue,
    private readonly autoDispatchService: AutoDispatchService,
    private readonly config: ConfigService,
    private readonly metrics: MetricsService,
  ) {}

  /** Called right after a pooled ride is saved with status POOL_MATCHING. */
  async requestPool(rideId: string): Promise<void> {
    const ride = await this.ridesRepo.findOneOrFail({ where: { id: rideId } });

    const matched = await this.tryMatch(ride);
    if (matched) return;

    const windowMs = this.config.get<number>('pooling.matchWindowMs')!;
    await this.poolMatchingQueue.add(
      'resolve-window',
      { rideId },
      { delay: windowMs, jobId: `pool-window-${rideId}` },
    );
  }

  /**
   * Fired by the delayed job once the match window elapses. No-ops if
   * the ride already matched (or was cancelled) via any other path in
   * the meantime — this is purely a fallback checkpoint, not the only
   * way a match can happen.
   */
  async resolveWindow(rideId: string): Promise<void> {
    const ride = await this.ridesRepo.findOne({ where: { id: rideId } });
    if (!ride || ride.status !== RideStatus.POOL_MATCHING) return;

    const matched = await this.tryMatch(ride);
    if (matched) return;

    this.logger.log(
      `Pool window expired for ride ${rideId} with no partner — falling back to solo AUTO dispatch`,
    );
    this.metrics.rideRequestsTotal.inc({
      category: `${ride.category}_pool_unmatched`,
    });
    ride.status = RideStatus.SEARCHING;
    ride.dispatchMode = DispatchMode.AUTO;
    await this.ridesRepo.save(ride);
    void this.autoDispatchService.startForRide(ride.id);
  }

  /** Best-effort cleanup when a pool-matching ride is cancelled before ever pairing. */
  async onRideCancelledBeforeMatch(rideId: string): Promise<void> {
    await this.poolMatchingQueue
      .remove(`pool-window-${rideId}`)
      .catch(() => undefined);
  }

  /**
   * Tries to find one compatible waiting partner for `ride` and, if
   * found, atomically pairs them into a new PoolGroup. Returns whether
   * a match was made.
   */
  private async tryMatch(ride: Ride): Promise<boolean> {
    const candidates = await this.ridesRepo.find({
      where: { status: RideStatus.POOL_MATCHING, category: ride.category },
      order: { createdAt: 'ASC' },
    });

    const maxPickupDetourKm = this.config.get<number>(
      'pooling.maxPickupDetourKm',
    )!;
    const maxDetourFraction = this.config.get<number>(
      'pooling.maxDetourFraction',
    )!;

    for (const candidate of candidates) {
      if (candidate.id === ride.id) continue;
      if ((ride.city ?? null) !== (candidate.city ?? null)) continue;
      if (
        haversineDistanceKm(
          ride.pickupLat,
          ride.pickupLng,
          candidate.pickupLat,
          candidate.pickupLng,
        ) > maxPickupDetourKm
      ) {
        continue;
      }

      const plan = this.bestRoutePlan(ride, candidate);
      if (!plan) continue;

      const soloA = haversineDistanceKm(
        ride.pickupLat,
        ride.pickupLng,
        ride.dropoffLat,
        ride.dropoffLng,
      );
      const soloB = haversineDistanceKm(
        candidate.pickupLat,
        candidate.pickupLng,
        candidate.dropoffLat,
        candidate.dropoffLng,
      );
      const detourA =
        soloA > 0 ? (plan.perRideDistanceKm[ride.id] - soloA) / soloA : 0;
      const detourB =
        soloB > 0 ? (plan.perRideDistanceKm[candidate.id] - soloB) / soloB : 0;
      if (detourA > maxDetourFraction || detourB > maxDetourFraction) continue;

      const paired = await this.pairRides(ride, candidate, plan);
      if (paired) return true;
      // Lost the race to claim one of these two rides (concurrent match
      // elsewhere) — keep scanning the rest of the candidate list.
    }

    return false;
  }

  /**
   * Atomically claims both rides for a new PoolGroup. Uses the same
   * "conditional UPDATE, check affected===1" concurrency pattern as
   * RidesService.acceptRide()'s driver reservation — two concurrent
   * tryMatch() calls racing to pair the same ride must not both
   * succeed.
   */
  private async pairRides(
    a: Ride,
    b: Ride,
    plan: {
      sequence: PoolRouteStop[];
      totalDistanceKm: number;
      totalDurationMin: number;
    },
  ): Promise<boolean> {
    const discountFraction = this.config.get<number>(
      'pooling.discountFraction',
    )!;

    return this.ridesRepo.manager
      .transaction(async (manager) => {
        const group = manager.create(PoolGroup, {
          status: PoolGroupStatus.MATCHED,
          anchorRideId: a.id,
          partnerRideId: b.id,
          city: a.city ?? b.city ?? null,
          routeSequence: plan.sequence,
          estimatedTotalDistanceKm: plan.totalDistanceKm,
          estimatedTotalDurationMin: plan.totalDurationMin,
          matchedAt: new Date(),
        });
        const savedGroup = await manager.save(group);

        let bothClaimed = true;
        for (const ride of [a, b]) {
          const discount = this.round(
            parseFloat(ride.totalFare) * discountFraction,
          );
          const newTotal = this.round(parseFloat(ride.totalFare) - discount);
          const otherRideId = ride.id === a.id ? b.id : a.id;

          const result = await manager
            .createQueryBuilder()
            .update(Ride)
            .set({
              status: RideStatus.SEARCHING,
              dispatchMode: DispatchMode.AUTO,
              poolGroupId: savedGroup.id,
              poolDiscountAmount: discount.toFixed(2),
              totalFare: newTotal.toFixed(2),
              discount: this.round(
                parseFloat(ride.discount) + discount,
              ).toFixed(2),
              stops: plan.sequence
                .filter((s) => s.rideId === otherRideId)
                .map((s) => ({
                  lat: s.lat,
                  lng: s.lng,
                  address: `Co-rider ${s.type}: ${s.address}`,
                })),
            })
            .where('id = :id', { id: ride.id })
            .andWhere('status = :status', { status: RideStatus.POOL_MATCHING })
            .execute();

          if (result.affected !== 1) {
            bothClaimed = false;
            break;
          }
        }

        if (!bothClaimed) {
          // Roll back by throwing — the transaction discards the
          // PoolGroup insert and both ride updates together.
          throw new Error('pool-claim-race');
        }

        this.metrics.rideRequestsTotal.inc({
          category: `${a.category}_pool_matched`,
        });
        this.logger.log(
          `Paired pooled rides ${a.id} + ${b.id} into group ${savedGroup.id}`,
        );

        // Anchor is whichever ride was requested first — its own dispatch
        // lifecycle drives the pair; see class doc comment.
        const anchorId = a.createdAt <= b.createdAt ? a.id : b.id;
        void this.autoDispatchService.startForRide(anchorId);

        return true;
      })
      .catch((err) => {
        if (err instanceof Error && err.message === 'pool-claim-race')
          return false;
        throw err;
      });
  }

  /**
   * Enumerates every stop ordering that respects "each ride's pickup
   * must come before its own dropoff" and returns the one with the
   * lowest total haversine distance, along with how far each rider
   * personally travels in it (used for the detour-fraction check).
   * Hardcoded for exactly 2 rides — see class doc comment.
   */
  private bestRoutePlan(
    a: Ride,
    b: Ride,
  ): {
    sequence: PoolRouteStop[];
    totalDistanceKm: number;
    totalDurationMin: number;
    perRideDistanceKm: Record<string, number>;
  } | null {
    const stops: PoolRouteStop[] = [
      {
        type: 'pickup',
        rideId: a.id,
        lat: a.pickupLat,
        lng: a.pickupLng,
        address: a.pickupAddress,
      },
      {
        type: 'dropoff',
        rideId: a.id,
        lat: a.dropoffLat,
        lng: a.dropoffLng,
        address: a.dropoffAddress,
      },
      {
        type: 'pickup',
        rideId: b.id,
        lat: b.pickupLat,
        lng: b.pickupLng,
        address: b.pickupAddress,
      },
      {
        type: 'dropoff',
        rideId: b.id,
        lat: b.dropoffLat,
        lng: b.dropoffLng,
        address: b.dropoffAddress,
      },
    ];

    let best: { order: number[]; totalDistanceKm: number } | null = null;

    for (const order of this.permutations([0, 1, 2, 3])) {
      const pickupA = order.indexOf(0);
      const dropoffA = order.indexOf(1);
      const pickupB = order.indexOf(2);
      const dropoffB = order.indexOf(3);
      if (pickupA > dropoffA || pickupB > dropoffB) continue;

      let total = 0;
      for (let i = 0; i < order.length - 1; i++) {
        const s1 = stops[order[i]];
        const s2 = stops[order[i + 1]];
        total += haversineDistanceKm(s1.lat, s1.lng, s2.lat, s2.lng);
      }

      if (!best || total < best.totalDistanceKm) {
        best = { order, totalDistanceKm: total };
      }
    }

    if (!best) return null;

    const sequence = best.order.map((i) => stops[i]);
    const pickupAIdx = best.order.indexOf(0);
    const dropoffAIdx = best.order.indexOf(1);
    const pickupBIdx = best.order.indexOf(2);
    const dropoffBIdx = best.order.indexOf(3);

    const legDistance = (fromIdx: number, toIdx: number) => {
      let d = 0;
      for (let i = fromIdx; i < toIdx; i++) {
        const s1 = stops[best.order[i]];
        const s2 = stops[best.order[i + 1]];
        d += haversineDistanceKm(s1.lat, s1.lng, s2.lat, s2.lng);
      }
      return d;
    };

    // Rough duration estimate — same 30km/h average-city-speed
    // approximation used elsewhere for haversine-based fallbacks, kept
    // here rather than importing FareService just for one constant.
    const AVG_SPEED_KMH = 30;

    return {
      sequence,
      totalDistanceKm: best.totalDistanceKm,
      totalDurationMin: (best.totalDistanceKm / AVG_SPEED_KMH) * 60,
      perRideDistanceKm: {
        [a.id]: legDistance(pickupAIdx, dropoffAIdx),
        [b.id]: legDistance(pickupBIdx, dropoffBIdx),
      },
    };
  }

  private *permutations<T>(arr: T[]): Generator<T[]> {
    if (arr.length <= 1) {
      yield arr;
      return;
    }
    for (let i = 0; i < arr.length; i++) {
      const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
      for (const perm of this.permutations(rest)) {
        yield [arr[i], ...perm];
      }
    }
  }

  private round(n: number): number {
    return Math.round(n * 100) / 100;
  }

  /**
   * Called from RidesService.acceptRide()'s pool propagation hook once
   * the anchor ride's driver reservation has committed. Assigns the
   * same driver/vehicle to the partner ride without running it through
   * dispatch a second time.
   */
  async propagateDriverAssignment(anchorRide: Ride): Promise<void> {
    if (!anchorRide.poolGroupId) return;
    const group = await this.poolGroupsRepo.findOne({
      where: { id: anchorRide.poolGroupId },
    });
    if (!group) return;

    const partnerRideId =
      group.anchorRideId === anchorRide.id
        ? group.partnerRideId
        : group.anchorRideId;
    const partner = await this.ridesRepo.findOne({
      where: { id: partnerRideId },
    });
    if (!partner || partner.status !== RideStatus.SEARCHING) {
      // Partner already cancelled/unpooled — nothing to propagate onto.
      return;
    }

    partner.driverId = anchorRide.driverId;
    partner.vehicleId = anchorRide.vehicleId;
    partner.status = RideStatus.ACCEPTED;
    partner.acceptedAt = anchorRide.acceptedAt;
    await this.ridesRepo.save(partner);

    group.status = PoolGroupStatus.DISPATCHED;
    await this.poolGroupsRepo.save(group);

    this.logger.log(
      `Propagated driver ${anchorRide.driverId} from anchor ride ${anchorRide.id} onto pooled partner ride ${partner.id}`,
    );
  }

  /**
   * Called when one side of an already-matched (but not yet dispatched)
   * pool cancels — the other rider shouldn't be stuck waiting on a pool
   * that will never complete. Reverts the surviving ride to a normal
   * solo request at its original fare and lets it dispatch normally.
   */
  async unpoolRide(rideId: string, reason: string): Promise<void> {
    const ride = await this.ridesRepo.findOne({ where: { id: rideId } });
    if (!ride || !ride.poolGroupId || ride.status !== RideStatus.SEARCHING)
      return;

    const groupId = ride.poolGroupId;
    ride.poolGroupId = null;
    ride.totalFare = this.round(
      parseFloat(ride.totalFare) + parseFloat(ride.poolDiscountAmount),
    ).toFixed(2);
    ride.discount = this.round(
      parseFloat(ride.discount) - parseFloat(ride.poolDiscountAmount),
    ).toFixed(2);
    ride.poolDiscountAmount = '0.00';
    ride.stops = null;
    await this.ridesRepo.save(ride);

    await this.poolGroupsRepo.update(
      { id: groupId },
      { status: PoolGroupStatus.UNWOUND, unwindReason: reason },
    );

    this.logger.log(`Unpooled ride ${ride.id} (group ${groupId}) — ${reason}`);
    // Ride is already SEARCHING/AUTO from the original pairing, so the
    // normal dispatch loop just needs a fresh kick now that it's solo.
    void this.autoDispatchService.startForRide(ride.id);
  }
}
