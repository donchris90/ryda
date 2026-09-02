import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import {
  LiveDriverIndexService,
  LiveDriverCandidate,
} from '../live-driver-index/live-driver-index.service';
import { DriverProfile } from '../drivers/entities/driver-profile.entity';
import { DriverServiceCapability } from '../drivers/entities/driver-service-capability.entity';
import { Vehicle } from '../vehicles/entities/vehicle.entity';
import {
  DriverApprovalStatus,
} from '../common/enums/driver-status.enum';
import { VehicleStatus } from '../common/enums/vehicle.enum';
import { DriverService, ServiceApprovalStatus, isOnlineForService } from '../common/enums/driver-service.enum';
import { doesVehicleMatchRideCategory } from '../common/ride-vehicle-match.util';
import { canVehicleCoverDelivery } from '../common/vehicle-capacity-match.util';
import { MetricsService } from '../observability/metrics.service';
import {
  CandidateResult,
  CandidateSearchInput,
  CandidateSearchOutcome,
  DispatchDomain,
  EligibilityDiagnostics,
} from './candidate-search.types';

/** Which DriverService a given search domain requires the driver to be approved+online for. */
function serviceForDomain(domain: DispatchDomain): DriverService {
  return domain === DispatchDomain.RIDE ? DriverService.RIDE : DriverService.DELIVERY;
}

/**
 * Single shared candidate-discovery engine for both MANUAL and AUTO
 * dispatch (rides), and for courier — see CandidateSearchInput.domain.
 * There is deliberately no separate search implementation per mode or per
 * domain; only the eligibility rules and radius unwind identically no
 * matter who calls this.
 *
 * Pipeline:
 *   Redis GEO (via LiveDriverIndexService, already stale-filtered)
 *     -> eligibility filtering against PostgreSQL (bounded to the
 *        handful of candidate ids just found — never a full online-driver
 *        scan)
 *     -> progressive radius expansion, only as far as needed
 *
 * This is candidate *discovery* only — it does not rank by ETA (batch 4)
 * and does not decide who gets offered a ride (batch 5/6). Everything it
 * returns is "eligible", not "chosen".
 */
@Injectable()
export class CandidateSearchService {
  private readonly logger = new Logger(CandidateSearchService.name);

  constructor(
    private readonly liveDriverIndex: LiveDriverIndexService,
    @InjectRepository(DriverProfile)
    private readonly driversRepo: Repository<DriverProfile>,
    @InjectRepository(Vehicle)
    private readonly vehiclesRepo: Repository<Vehicle>,
    @InjectRepository(DriverServiceCapability)
    private readonly capabilitiesRepo: Repository<DriverServiceCapability>,
    private readonly config: ConfigService,
    private readonly metrics: MetricsService,
  ) {}

  async search(input: CandidateSearchInput): Promise<CandidateSearchOutcome> {
    this.validateInput(input);
    const stopTimer = this.metrics.candidateSearchDurationSeconds.startTimer({
      domain: input.domain,
      mode: input.mode,
    });

    try {
      return await this.doSearch(input);
    } finally {
      stopTimer();
    }
  }

  private async doSearch(
    input: CandidateSearchInput,
  ): Promise<CandidateSearchOutcome> {
    const initialRadiusKm =
      this.config.get<number>('dispatch.initialRadiusKm') ?? 8;
    const maxRadiusKm = this.config.get<number>('dispatch.maxRadiusKm') ?? 15;
    const stepKm = this.config.get<number>('dispatch.radiusStepKm') ?? 4;
    const fetchLimit =
      this.config.get<number>('dispatch.candidateFetchLimit') ?? 50;
    const minCandidates = input.minCandidates ?? 1;
    const resultLimit = input.limit ?? fetchLimit;
    const excludeSet = new Set(input.excludeDriverUserIds ?? []);

    const rounds = this.buildRadiusRounds(initialRadiusKm, maxRadiusKm, stepKm);

    let radiusUsedKm = rounds[0];
    let roundsAttempted = 0;
    let eligible: CandidateResult[] = [];
    // Populated by the final round attempted — used only for the
    // zero-candidate diagnostic log below, never returned to callers.
    let lastDiagnostics: EligibilityDiagnostics = {
      redisCandidateCount: 0,
      approvedCandidateCount: 0,
      onlineCandidateCount: 0,
      serviceApprovedCandidateCount: 0,
      activeVehicleCandidateCount: 0,
      activeVehicleStatusCandidateCount: 0,
      compatibleVehicleCandidateCount: 0,
      rejectionReasons: {},
    };

    for (const radiusKm of rounds) {
      roundsAttempted += 1;
      radiusUsedKm = radiusKm;

      const raw = await this.liveDriverIndex.searchNearby(
        input.pickup,
        radiusKm,
        fetchLimit,
      );
      const filtered = raw.filter((c) => !excludeSet.has(c.driverUserId));

      if (filtered.length > 0) {
        const { results, diagnostics } = await this.applyEligibility(
          filtered,
          input,
        );
        eligible = results;
        lastDiagnostics = diagnostics;
      } else {
        eligible = [];
        lastDiagnostics = {
          redisCandidateCount: 0,
          approvedCandidateCount: 0,
          onlineCandidateCount: 0,
          serviceApprovedCandidateCount: 0,
          activeVehicleCandidateCount: 0,
          activeVehicleStatusCandidateCount: 0,
          compatibleVehicleCandidateCount: 0,
          rejectionReasons: {},
        };
      }

      const reachedMax = radiusKm >= maxRadiusKm;
      if (eligible.length >= minCandidates || reachedMax) break;
    }

    const labels = { domain: input.domain, mode: input.mode };
    this.metrics.candidateSearchCandidateCount.observe(labels, eligible.length);
    if (radiusUsedKm > initialRadiusKm) {
      this.metrics.candidateSearchRadiusExpansionTotal.inc(labels);
    }

    // Development/debug-only diagnostic — see requirement NINTH: a
    // structured breakdown of exactly where candidates fell out of the
    // pipeline, logged only when the search came back empty. Uses
    // logger.debug rather than .log/.warn so it's silent at the default
    // production log level and opt-in via LOG_LEVEL=debug, per "should
    // be appropriately controlled for production." Never logs driver
    // PII — only counts and driverUserId/reason pairs, both already
    // internal identifiers a dispatcher/on-call engineer needs to trace
    // a real report of "my driver never got offered anything."
    if (eligible.length === 0) {
      this.logger.debug(
        'COURIER_MATCH_DIAGNOSTIC ' +
          JSON.stringify({
            domain: input.domain,
            pickup: input.pickup,
            requestedVehicleType:
              input.deliveryVehicleType ?? input.rideCategory ?? null,
            radiusUsedKm,
            roundsAttempted,
            redisCandidateCount: lastDiagnostics.redisCandidateCount,
            approvedCandidateCount: lastDiagnostics.approvedCandidateCount,
            onlineCandidateCount: lastDiagnostics.onlineCandidateCount,
            serviceApprovedCandidateCount: lastDiagnostics.serviceApprovedCandidateCount,
            activeVehicleCandidateCount:
              lastDiagnostics.activeVehicleCandidateCount,
            activeVehicleStatusCandidateCount:
              lastDiagnostics.activeVehicleStatusCandidateCount,
            compatibleVehicleCandidateCount:
              lastDiagnostics.compatibleVehicleCandidateCount,
            finalCandidateCount: eligible.length,
            rejections: lastDiagnostics.rejectionReasons,
          }),
      );
    }

    return {
      candidates: eligible.slice(0, resultLimit),
      radiusUsedKm,
      roundsAttempted,
    };
  }

  /**
   * Builds the ascending radius rounds a search progressively expands
   * through, e.g. initial=8/max=15/step=4 -> [8, 12, 15] — matching the
   * exact 0–8/8–12/12–15 rounds product asked for by default, entirely
   * from configuration rather than hardcoded steps.
   */
  private buildRadiusRounds(
    initialKm: number,
    maxKm: number,
    stepKm: number,
  ): number[] {
    const safeMax = Math.max(initialKm, maxKm);
    const safeStep = stepKm > 0 ? stepKm : safeMax - initialKm || 1;

    const rounds: number[] = [Math.min(initialKm, safeMax)];
    let current = rounds[0];
    while (current < safeMax) {
      current = Math.min(current + safeStep, safeMax);
      rounds.push(current);
    }
    return rounds;
  }

  /**
   * Safe, non-PII reasons a candidate fell out of eligibility — logged
   * per requirement NINTH, never includes names/phone numbers/documents,
   * only the driverUserId (already an internal identifier) and which
   * stage rejected them.
   */
  private static readonly RejectionReason = {
    NOT_APPROVED: 'NOT_APPROVED',
    NOT_ONLINE: 'NOT_ONLINE',
    NOT_APPROVED_FOR_SERVICE: 'NOT_APPROVED_FOR_SERVICE',
    NO_ACTIVE_VEHICLE: 'NO_ACTIVE_VEHICLE',
    VEHICLE_INACTIVE: 'VEHICLE_INACTIVE',
    INCOMPATIBLE_VEHICLE: 'INCOMPATIBLE_VEHICLE',
  } as const;

  /**
   * Filters a raw geospatial candidate set down to drivers who are
   * actually dispatchable right now. PostgreSQL (not the Redis index) is
   * treated as authoritative here for approval/availability/vehicle —
   * the index can lag by up to one event-processing cycle, and re-reading
   * a small, already-bounded set of specific driver rows is cheap
   * insurance against dispatching to a driver who went on-trip or
   * offline a moment after their last location ping.
   *
   * Also re-checks, per search domain, that the driver both holds an
   * APPROVED DriverServiceCapability for that service AND is currently
   * online specifically for it (ONLINE_FOR_RIDES/_DELIVERIES/_BOTH as
   * appropriate) — see driver-service.enum.ts. This is the actual
   * "approved services vs current availability" split the whole feature
   * is about: a driver approved for RIDE+DELIVERY who is only online for
   * rides right now must never appear in a courier search, and a
   * driver online for "both" who was only ever approved for RIDE must
   * never appear in one either.
   *
   * NOTE: this does not yet check "not already reserved/locked for
   * another in-flight dispatch" — no such reservation mechanism exists
   * in the codebase yet. That's a real gap, tracked for the atomic
   * driver-reservation work in a later batch (manual/auto dispatch
   * wiring); flagging it here rather than silently treating "ONLINE in
   * Postgres" as equivalent to "not mid-offer".
   */
  private async applyEligibility(
    raw: LiveDriverCandidate[],
    input: CandidateSearchInput,
  ): Promise<{
    results: CandidateResult[];
    diagnostics: EligibilityDiagnostics;
  }> {
    const driverUserIds = raw.map((c) => c.driverUserId);
    const distanceByUserId = new Map(
      raw.map((c) => [c.driverUserId, c.distanceKm]),
    );
    const positionByUserId = new Map(
      raw.map((c) => [c.driverUserId, { lat: c.lat, lng: c.lng }]),
    );

    const diagnostics: EligibilityDiagnostics = {
      redisCandidateCount: raw.length,
      approvedCandidateCount: 0,
      onlineCandidateCount: 0,
      serviceApprovedCandidateCount: 0,
      activeVehicleCandidateCount: 0,
      activeVehicleStatusCandidateCount: 0,
      compatibleVehicleCandidateCount: 0,
      rejectionReasons: {},
    };

    const profiles = await this.driversRepo.find({
      where: { userId: In(driverUserIds) },
    });
    if (profiles.length === 0) return { results: [], diagnostics };

    const requiredService = serviceForDomain(input.domain);
    const approvedCapabilities = await this.capabilitiesRepo.find({
      where: {
        driverProfileId: In(profiles.map((p) => p.id)),
        service: requiredService,
        status: ServiceApprovalStatus.APPROVED,
      },
    });
    const approvedDriverProfileIds = new Set(approvedCapabilities.map((c) => c.driverProfileId));

    const vehicleIds = profiles
      .map((p) => p.activeVehicleId)
      .filter((id): id is string => !!id);
    const vehicles = vehicleIds.length
      ? await this.vehiclesRepo.find({ where: { id: In(vehicleIds) } })
      : [];
    const vehicleById = new Map(vehicles.map((v) => [v.id, v]));

    const results: CandidateResult[] = [];

    for (const profile of profiles) {
      if (profile.approvalStatus !== DriverApprovalStatus.APPROVED) {
        diagnostics.rejectionReasons[profile.userId] =
          CandidateSearchService.RejectionReason.NOT_APPROVED;
        continue;
      }
      diagnostics.approvedCandidateCount += 1;

      if (!isOnlineForService(profile.availability, requiredService)) {
        diagnostics.rejectionReasons[profile.userId] =
          CandidateSearchService.RejectionReason.NOT_ONLINE;
        continue;
      }
      diagnostics.onlineCandidateCount += 1;

      if (!approvedDriverProfileIds.has(profile.id)) {
        diagnostics.rejectionReasons[profile.userId] =
          CandidateSearchService.RejectionReason.NOT_APPROVED_FOR_SERVICE;
        continue;
      }
      diagnostics.serviceApprovedCandidateCount += 1;

      if (!profile.activeVehicleId) {
        diagnostics.rejectionReasons[profile.userId] =
          CandidateSearchService.RejectionReason.NO_ACTIVE_VEHICLE;
        continue;
      }
      diagnostics.activeVehicleCandidateCount += 1;

      const vehicle = vehicleById.get(profile.activeVehicleId);
      if (!vehicle) {
        diagnostics.rejectionReasons[profile.userId] =
          CandidateSearchService.RejectionReason.NO_ACTIVE_VEHICLE;
        continue;
      }
      if (vehicle.status !== VehicleStatus.ACTIVE) {
        diagnostics.rejectionReasons[profile.userId] =
          CandidateSearchService.RejectionReason.VEHICLE_INACTIVE;
        continue;
      }
      diagnostics.activeVehicleStatusCandidateCount += 1;

      if (!this.isVehicleCompatible(vehicle, input)) {
        diagnostics.rejectionReasons[profile.userId] =
          CandidateSearchService.RejectionReason.INCOMPATIBLE_VEHICLE;
        continue;
      }
      diagnostics.compatibleVehicleCandidateCount += 1;

      const position = positionByUserId.get(profile.userId);

      results.push({
        driverUserId: profile.userId,
        driverProfileId: profile.id,
        vehicleId: vehicle.id,
        vehicleCategory: vehicle.category,
        lat: position?.lat ?? 0,
        lng: position?.lng ?? 0,
        distanceKm: distanceByUserId.get(profile.userId) ?? 0,
        rating: parseFloat(profile.rating),
        level: profile.level,
        totalTrips: profile.totalTrips,
        cancelledTrips: profile.cancelledTrips,
      });
    }

    return {
      results: results.sort((a, b) => a.distanceKm - b.distanceKm),
      diagnostics,
    };
  }

  /** Never cross-checks a ride category against courier logic or vice versa — see candidate-search.types.ts. */
  private isVehicleCompatible(
    vehicle: Vehicle,
    input: CandidateSearchInput,
  ): boolean {
    if (input.domain === DispatchDomain.RIDE) {
      return (
        !!input.rideCategory &&
        doesVehicleMatchRideCategory(vehicle, input.rideCategory)
      );
    }
    if (input.domain === DispatchDomain.COURIER) {
      return (
        !!input.deliveryVehicleType &&
        canVehicleCoverDelivery(vehicle.category, input.deliveryVehicleType)
      );
    }
    return false;
  }

  private validateInput(input: CandidateSearchInput): void {
    if (input.domain === DispatchDomain.RIDE && !input.rideCategory) {
      throw new Error(
        'rideCategory is required for a RIDE-domain candidate search',
      );
    }
    if (input.domain === DispatchDomain.COURIER && !input.deliveryVehicleType) {
      throw new Error(
        'deliveryVehicleType is required for a COURIER-domain candidate search',
      );
    }
  }
}
