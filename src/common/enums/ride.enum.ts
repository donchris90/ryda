export enum RideStatus {
  SCHEDULED = 'scheduled',
  REQUESTED = 'requested',
  // Batch-matching window for a pooled request, before it either pairs
  // off (moves to SEARCHING with a poolGroupId, see PoolMatchingService)
  // or falls back to a normal solo SEARCHING ride when the window
  // expires unpaired. Added by migration AddRidePoolingColumns.
  POOL_MATCHING = 'pool_matching',
  SEARCHING = 'searching',
  ACCEPTED = 'accepted',
  ARRIVING = 'arriving',
  ARRIVED = 'arrived',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
  NO_DRIVER_FOUND = 'no_driver_found',
}

// Passenger ride categories, deliberately kept to two tiers per product
// decision — haulage/bike-delivery needs are served by the separate
// Logistics module (DeliveryVehicleType: bike/keke/car/van/pickup/truck),
// not by adding more passenger-ride categories here.
export enum RideCategory {
  ECONOMY = 'economy',
  COMFORT = 'comfort',
}

export enum PaymentMethod {
  CARD = 'card',
  WALLET = 'wallet',
  CASH = 'cash',
  BANK_TRANSFER = 'bank_transfer',
  CORPORATE = 'corporate',
}

export enum CancelledBy {
  PASSENGER = 'passenger',
  DRIVER = 'driver',
  SYSTEM = 'system',
}
