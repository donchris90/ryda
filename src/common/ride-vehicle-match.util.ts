import { RideCategory } from '../common/enums/ride.enum';
import { VehicleCategory } from '../common/enums/vehicle.enum';

/**
 * Strict, not permissive (unlike delivery vehicle matching) - a
 * passenger choosing "Comfort" is choosing a specific experience, not
 * just asking for enough capacity, so a random car showing up for it
 * would defeat the entire point of offering the category. Economy and
 * Comfort both map to the same "car" registration - there's no
 * dedicated vehicle tier distinguishing them in what a driver actually
 * registers, and that's a real limitation of the current data model.
 *
 * Because of that, ride categories fall into two groups:
 *  - DEFAULT-ELIGIBLE (this map): any vehicle registered in the
 *    mapped VehicleCategory automatically qualifies, no admin
 *    approval needed. Economy is the base tier every driver's car
 *    should serve.
 *  - APPROVAL-REQUIRED (below): deliberately absent from this map.
 *    Comfort has no default path at all - a vehicle only qualifies
 *    once an admin has explicitly approved it (approvedRideCategories).
 *    Without this split, every VehicleCategory.CAR would automatically
 *    satisfy both Economy and Comfort, defeating the point of the tier.
 */
const DEFAULT_ELIGIBLE_RIDE_CATEGORY_TO_VEHICLE_CATEGORY: Partial<Record<RideCategory, VehicleCategory>> = {
  [RideCategory.ECONOMY]: VehicleCategory.CAR,
};

// Ride categories that intentionally have no entry above and can only
// ever be granted through the admin approval override.
const APPROVAL_REQUIRED_RIDE_CATEGORIES: RideCategory[] = [RideCategory.COMFORT];

// TypeScript's Record<K, V> typing does not reliably enforce
// completeness when an object literal uses computed enum-member keys
// ([RideCategory.X]: ...) rather than plain string literals - a real
// gap found and fixed once already on this exact file, when
// RideCategory briefly had 10 values and this only had 2. Every
// RideCategory must now appear in exactly one of the two groups above:
// left out of both, it could never match any driver; listed in both,
// it would silently skip the approval gate it needs.
for (const category of Object.values(RideCategory)) {
  const hasDefault = category in DEFAULT_ELIGIBLE_RIDE_CATEGORY_TO_VEHICLE_CATEGORY;
  const requiresApproval = APPROVAL_REQUIRED_RIDE_CATEGORIES.includes(category);
  if (hasDefault === requiresApproval) {
    throw new Error(
      `RideCategory.${category} must be listed in exactly one of DEFAULT_ELIGIBLE_RIDE_CATEGORY_TO_VEHICLE_CATEGORY or APPROVAL_REQUIRED_RIDE_CATEGORIES, or rides booked with it may silently never match a driver (if in neither) or silently bypass admin approval (if in both).`,
    );
  }
}

/**
 * True if a vehicle can serve a given ride category - either through
 * the default mapping (default-eligible categories only, e.g.
 * Economy), OR because an admin has explicitly approved this specific
 * vehicle for that category (approvedRideCategories). Approval-required
 * categories like Comfort have no default path at all: two identical
 * VehicleCategory.CAR registrations can be genuinely different in real
 * quality, and that's a human judgment call per vehicle, not something
 * a rigid enum can express.
 */
export function doesVehicleMatchRideCategory(
  vehicle: { category: VehicleCategory; approvedRideCategories?: string[] | null },
  rideCategory: RideCategory,
): boolean {
  if (DEFAULT_ELIGIBLE_RIDE_CATEGORY_TO_VEHICLE_CATEGORY[rideCategory] === vehicle.category) return true;
  return !!vehicle.approvedRideCategories?.includes(rideCategory);
}
