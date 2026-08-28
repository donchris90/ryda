import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { LiveDriverIndexService, LiveDriverCandidate } from '../live-driver-index/live-driver-index.service';
import { DriverProfile } from '../drivers/entities/driver-profile.entity';
import { Vehicle } from '../vehicles/entities/vehicle.entity';
import { DriverApprovalStatus, DriverAvailability } from '../common/enums/driver-status.enum';
import { VehicleStatus } from '../common/enums/vehicle.enum';
import { doesVehicleMatchRideCategory } from '../common/ride-vehicle-match.util';
import { canVehicleCoverDelivery } from '../common/vehicle-capacity-match.util';
import { MetricsService } from '../observability/metrics.service';
import { CandidateResult, CandidateSearchInput, CandidateSearchOutcome, DispatchDomain } from './candidate-search.types';

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
    @InjectRepository(DriverProfile) private readonly driversRepo: Repository<DriverProfile>,
    @InjectRepository(Vehicle) private readonly vehiclesRepo: Repository<Vehicle>,
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

  private async doSearch(input: CandidateSearchInput): Promise<CandidateSearchOutcome> {
    const initialRadiusKm = this.config.get<number>('dispatch.initialRadiusKm') ?? 8;
    const maxRadiusKm = this.config.get<number>('dispatch.maxRadiusKm') ?? 15;
    const stepKm = this.config.get<number>('dispatch.radiusStepKm') ?? 4;
    const fetchLimit = this.config.get<number>('dispatch.candidateFetchLimit') ?? 50;
    const minCandidates = input.minCandidates ?? 1;
    const resultLimit = input.limit ?? fetchLimit;
    const excludeSet = new Set(input.excludeDriverUserIds ?? []);

    const rounds = this.buildRadiusRounds(initialRadiusKm, maxRadiusKm, stepKm);

    let radiusUsedKm = rounds[0];
    let roundsAttempted = 0;
    let eligible: CandidateResult[] = [];

    for (const radiusKm of rounds) {
      roundsAttempted += 1;
      radiusUsedKm = radiusKm;

      const raw = await this.liveDriverIndex.searchNearby(input.pickup, radiusKm, fetchLimit);
      const filtered = raw.filter((c) => !excludeSet.has(c.driverUserId));

      eligible = filtered.length > 0 ? await this.applyEligibility(filtered, input) : [];

      const reachedMax = radiusKm >= maxRadiusKm;
      if (eligible.length >= minCandidates || reachedMax) break;
    }

    const labels = { domain: input.domain, mode: input.mode };
    this.metrics.candidateSearchCandidateCount.observe(labels, eligible.length);
    if (radiusUsedKm > initialRadiusKm) {
      this.metrics.candidateSearchRadiusExpansionTotal.inc(labels);
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
  private buildRadiusRounds(initialKm: number, maxKm: number, stepKm: number): number[] {
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
   * Filters a raw geospatial candidate set down to drivers who are
   * actually dispatchable right now. PostgreSQL (not the Redis index) is
   * treated as authoritative here for approval/availability/vehicle —
   * the index can lag by up to one event-processing cycle, and re-reading
   * a small, already-bounded set of specific driver rows is cheap
   * insurance against dispatching to a driver who went on-trip or
   * offline a moment after their last location ping.
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
  ): Promise<CandidateResult[]> {
    const driverUserIds = raw.map((c) => c.driverUserId);
    const distanceByUserId = new Map(raw.map((c) => [c.driverUserId, c.distanceKm]));
    const positionByUserId = new Map(raw.map((c) => [c.driverUserId, { lat: c.lat, lng: c.lng }]));

    const profiles = await this.driversRepo.find({ where: { userId: In(driverUserIds) } });
    if (profiles.length === 0) return [];

    const vehicleIds = profiles
      .map((p) => p.activeVehicleId)
      .filter((id): id is string => !!id);
    const vehicles = vehicleIds.length
      ? await this.vehiclesRepo.find({ where: { id: In(vehicleIds) } })
      : [];
    const vehicleById = new Map(vehicles.map((v) => [v.id, v]));

    const results: CandidateResult[] = [];

    for (const profile of profiles) {
      if (profile.approvalStatus !== DriverApprovalStatus.APPROVED) continue;
      if (profile.availability !== DriverAvailability.ONLINE) continue;
      if (!profile.activeVehicleId) continue;

      const vehicle = vehicleById.get(profile.activeVehicleId);
      if (!vehicle) continue;
      if (vehicle.status !== VehicleStatus.ACTIVE) continue;
      if (!this.isVehicleCompatible(vehicle, input)) continue;

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
      });
    }

    return results.sort((a, b) => a.distanceKm - b.distanceKm);
  }

  /** Never cross-checks a ride category against courier logic or vice versa — see candidate-search.types.ts. */
  private isVehicleCompatible(vehicle: Vehicle, input: CandidateSearchInput): boolean {
    if (input.domain === DispatchDomain.RIDE) {
      return !!input.rideCategory && doesVehicleMatchRideCategory(vehicle, input.rideCategory);
    }
    if (input.domain === DispatchDomain.COURIER) {
      return !!input.deliveryVehicleType && canVehicleCoverDelivery(vehicle.category, input.deliveryVehicleType);
    }
    return false;
  }

  private validateInput(input: CandidateSearchInput): void {
    if (input.domain === DispatchDomain.RIDE && !input.rideCategory) {
      throw new Error('rideCategory is required for a RIDE-domain candidate search');
    }
    if (input.domain === DispatchDomain.COURIER && !input.deliveryVehicleType) {
      throw new Error('deliveryVehicleType is required for a COURIER-domain candidate search');
    }
  }
}
