import { DeliveryVehicleType } from '../logistics/entities/delivery-order.entity';
import { VehicleCategory } from '../common/enums/vehicle.enum';

/**
 * Capacity rank, low to high - mirrors the exact ordering from the
 * original delivery vehicle types spec (bike < keke < car < van <
 * pickup < truck, by max weight). Used to decide whether a driver's
 * registered vehicle can cover a given delivery request: permissive,
 * not exact-match - a van driver can carry what a bike delivery needs,
 * a bike driver cannot cover what a van delivery needs.
 */
const DELIVERY_VEHICLE_RANK: Record<DeliveryVehicleType, number> = {
  [DeliveryVehicleType.BIKE]: 1,
  [DeliveryVehicleType.KEKE]: 2,
  [DeliveryVehicleType.CAR]: 3,
  [DeliveryVehicleType.VAN]: 4,
  [DeliveryVehicleType.PICKUP]: 5,
  [DeliveryVehicleType.TRUCK]: 6,
};

/**
 * Maps a driver's registered VehicleCategory onto the same rank scale.
 * These are two separate enums that were never reconciled - drivers
 * register under VehicleCategory (used for rides too), passengers pick
 * a DeliveryVehicleType when sending a package. car/van/truck already
 * mean the same thing in both; motorcycle/tricycle needed an explicit
 * mapping to bike/keke. Categories with no real delivery-capacity
 * equivalent (taxi, luxury, ev, bus) are mapped to the closest
 * reasonable rank rather than excluded entirely, so a driver who
 * registered under one of these isn't silently locked out of every
 * delivery.
 */
const VEHICLE_CATEGORY_RANK: Record<VehicleCategory, number> = {
  [VehicleCategory.MOTORCYCLE]: DELIVERY_VEHICLE_RANK[DeliveryVehicleType.BIKE],
  [VehicleCategory.TRICYCLE]: DELIVERY_VEHICLE_RANK[DeliveryVehicleType.KEKE],
  [VehicleCategory.CAR]: DELIVERY_VEHICLE_RANK[DeliveryVehicleType.CAR],
  [VehicleCategory.TAXI]: DELIVERY_VEHICLE_RANK[DeliveryVehicleType.CAR],
  [VehicleCategory.EV]: DELIVERY_VEHICLE_RANK[DeliveryVehicleType.CAR],
  [VehicleCategory.SUV]: DELIVERY_VEHICLE_RANK[DeliveryVehicleType.VAN],
  [VehicleCategory.LUXURY]: DELIVERY_VEHICLE_RANK[DeliveryVehicleType.CAR],
  [VehicleCategory.VAN]: DELIVERY_VEHICLE_RANK[DeliveryVehicleType.VAN],
  [VehicleCategory.BUS]: DELIVERY_VEHICLE_RANK[DeliveryVehicleType.VAN],
  [VehicleCategory.TRUCK]: DELIVERY_VEHICLE_RANK[DeliveryVehicleType.TRUCK],
};

/** True if a driver's registered vehicle category can physically cover a delivery requesting the given vehicle type. */
export function canVehicleCoverDelivery(driverCategory: VehicleCategory, requestedType: DeliveryVehicleType): boolean {
  return VEHICLE_CATEGORY_RANK[driverCategory] >= DELIVERY_VEHICLE_RANK[requestedType];
}
