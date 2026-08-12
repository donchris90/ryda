import { RideCategory } from '../common/enums/ride.enum';
import { VehicleCategory } from '../common/enums/vehicle.enum';

/**
 * Strict, not permissive (unlike delivery vehicle matching) - a
 * passenger choosing "Executive" is choosing a specific experience,
 * not just asking for enough capacity, so a random car showing up for
 * it would defeat the entire point of offering the category. Economy
 * and Comfort both map to the same "car" registration - there's no
 * dedicated vehicle tier distinguishing them in what a driver actually
 * registers, and that's a real limitation of the current data model,
 * not an oversight here specifically.
 */
const RIDE_CATEGORY_TO_VEHICLE_CATEGORY: Record<RideCategory, VehicleCategory> = {
  [RideCategory.ECONOMY]: VehicleCategory.CAR,
  [RideCategory.COMFORT]: VehicleCategory.CAR,
  [RideCategory.EXECUTIVE]: VehicleCategory.LUXURY,
  [RideCategory.XL]: VehicleCategory.VAN,
  [RideCategory.SUV]: VehicleCategory.SUV,
  [RideCategory.ELECTRIC]: VehicleCategory.EV,
  [RideCategory.MOTORCYCLE]: VehicleCategory.MOTORCYCLE,
  [RideCategory.TRICYCLE]: VehicleCategory.TRICYCLE,
  [RideCategory.TAXI]: VehicleCategory.TAXI,
  [RideCategory.LUXURY]: VehicleCategory.LUXURY,
};

/** True if a driver's registered vehicle category matches what a given ride category requires. */
export function doesVehicleMatchRideCategory(driverCategory: VehicleCategory, rideCategory: RideCategory): boolean {
  return RIDE_CATEGORY_TO_VEHICLE_CATEGORY[rideCategory] === driverCategory;
}
