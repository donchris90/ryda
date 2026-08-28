import { RideCategory } from '../common/enums/ride.enum';
import { DeliveryVehicleType } from '../logistics/entities/delivery-order.entity';
import { VehicleCategory } from '../common/enums/vehicle.enum';
import { DriverLevel } from '../common/enums/driver-level.enum';

/**
 * Which business the search is for. Deliberately separate from
 * "what vehicle category is required" — RIDE and COURIER each have their
 * own, non-overlapping category system (RideCategory vs DeliveryVehicleType)
 * and mixing them is exactly the bug this type split exists to make
 * impossible at the call site.
 */
export enum DispatchDomain {
  RIDE = 'ride',
  COURIER = 'courier',
}

/**
 * MANUAL and AUTO must produce the *same* eligible pool from the *same*
 * inputs — this flag exists for logging/metrics only (batch 9), and is
 * deliberately never branched on inside the eligibility or radius logic
 * below. If a future change makes it tempting to branch on `mode`, that's
 * a sign the two dispatch paths are drifting apart again.
 */
export enum DispatchMode {
  MANUAL = 'manual',
  AUTO = 'auto',
}

export interface CandidateSearchInput {
  pickup: { lat: number; lng: number };
  domain: DispatchDomain;
  mode: DispatchMode;
  /** Required when domain === RIDE. */
  rideCategory?: RideCategory;
  /** Required when domain === COURIER. */
  deliveryVehicleType?: DeliveryVehicleType;
  /** Drivers to skip regardless of eligibility — e.g. AUTO's already-declined/timed-out list. */
  excludeDriverUserIds?: string[];
  /** Stop expanding the search radius once at least this many eligible candidates are found. Defaults to 1. */
  minCandidates?: number;
  /** Cap on the number of eligible candidates returned. Defaults to config dispatch.candidateFetchLimit. */
  limit?: number;
}

export interface CandidateResult {
  driverUserId: string;
  driverProfileId: string;
  vehicleId: string;
  vehicleCategory: VehicleCategory;
  /** Driver's live position at the time of the search — needed by the ranking layer to compute road ETA to pickup. */
  lat: number;
  lng: number;
  distanceKm: number;
  rating: number;
  level: DriverLevel;
}

export interface CandidateSearchOutcome {
  candidates: CandidateResult[];
  /** The radius (km) the winning round searched at — internal/metrics use, never shown to the passenger. */
  radiusUsedKm: number;
  /** How many progressive-expansion rounds were attempted. */
  roundsAttempted: number;
}
