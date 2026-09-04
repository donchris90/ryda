import { RideCategory } from '../common/enums/ride.enum';
import { VehicleCategory } from '../common/enums/vehicle.enum';

/**
 * Strict, not permissive (unlike delivery vehicle matching) - a
 * passenger choosing "Comfort" is choosing a specific experience, not
 * just asking for enough capacity, so a random car showing up for it
 * would defeat the entire point of offering the category. There's no
 * dedicated vehicle tier for Comfort in what a driver actually
 * registers (both it and Economy register the same VehicleCategory.CAR),
 * so a plain, unapproved car deliberately does NOT default-match
 * Comfort the way it does Economy - `null` here means "no default
 * match, approval required," not "forgot to fill this in" (see the
 * completeness check below, which still requires every RideCategory to
 * have an entry, just possibly a null one).
 */
const RIDE_CATEGORY_TO_VEHICLE_CATEGORY: Record<RideCategory, VehicleCategory | null> = {
  [RideCategory.ECONOMY]: VehicleCategory.CAR,
  [RideCategory.COMFORT]: null,
};

// TypeScript's Record<K, V> typing does not reliably enforce
// completeness when an object literal uses computed enum-member keys
// ([RideCategory.X]: ...) rather than plain string literals - a real
// gap found and fixed once already on this exact file, when
// RideCategory briefly had 10 values and this only had 2. Kept as a
// cheap, real safeguard even now that RideCategory is back down to 2,
// so a future addition to the enum can't silently repeat that mistake.
for (const category of Object.values(RideCategory)) {
  if (!(category in RIDE_CATEGORY_TO_VEHICLE_CATEGORY)) {
    throw new Error(
      `RIDE_CATEGORY_TO_VEHICLE_CATEGORY is missing an entry for RideCategory.${category} - every ride category must map to a required vehicle category (or explicitly null for "approval only"), or rides booked with it will silently never match a driver.`,
    );
  }
}

/**
 * True if a vehicle can serve a given ride category - either through
 * the strict default mapping (its registered category matches
 * exactly, and the category actually HAS a default match - see
 * RIDE_CATEGORY_TO_VEHICLE_CATEGORY's own comment on why Comfort's is
 * null), OR because an admin has explicitly approved this specific
 * vehicle for that category (approvedRideCategories). The second path
 * exists specifically so "is this car nice enough for Comfort/XL/
 * Luxury" can be a human judgment call per vehicle, not something a
 * rigid enum can express - two identical VehicleCategory.CAR
 * registrations can be genuinely different in real quality.
 */
export function doesVehicleMatchRideCategory(
  vehicle: { category: VehicleCategory; approvedRideCategories?: string[] | null },
  rideCategory: RideCategory,
): boolean {
  const defaultMatch = RIDE_CATEGORY_TO_VEHICLE_CATEGORY[rideCategory];
  if (defaultMatch !== null && defaultMatch === vehicle.category) return true;
  return !!vehicle.approvedRideCategories?.includes(rideCategory);
}

/**
 * True only for a vehicle actually REGISTERED as wheelchair-accessible
 * - not a guess about whether some other vehicle could physically fit
 * a passenger who uses one. A driver who wants to serve accessible
 * rides registers the vehicle as such; a plain car doesn't become
 * "accessible" just because it has room, since registration is what
 * a passenger requesting accessibility can actually trust.
 */
export function isWheelchairAccessibleVehicle(vehicle: { category: VehicleCategory }): boolean {
  return vehicle.category === VehicleCategory.WHEELCHAIR_ACCESSIBLE;
}
