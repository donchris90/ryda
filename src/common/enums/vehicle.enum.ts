export enum VehicleCategory {
  CAR = 'car',
  SUV = 'suv',
  TAXI = 'taxi',
  LUXURY = 'luxury',
  EV = 'ev',
  MOTORCYCLE = 'motorcycle',
  TRICYCLE = 'tricycle',
  VAN = 'van',
  BUS = 'bus',
  TRUCK = 'truck',
  // A vehicle fitted for wheelchair boarding (ramp/lift + secured
  // wheelchair space) - modeled as its own category, same precedent as
  // EV: it's technically an attribute a CAR/VAN could have, but there's
  // no separate "is accessible" flag on the entity, so it's called out
  // as a distinct registration the same way electric vehicles are.
  // See ride-vehicle-match.util.ts for how this interacts with
  // RideCategory (it deliberately does not become a third ride tier).
  WHEELCHAIR_ACCESSIBLE = 'wheelchair_accessible',
}

export enum VehicleStatus {
  PENDING_INSPECTION = 'pending_inspection',
  ACTIVE = 'active',
  MAINTENANCE = 'maintenance',
  DEACTIVATED = 'deactivated',
}
