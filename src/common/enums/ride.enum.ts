export enum RideStatus {
  SCHEDULED = 'scheduled',
  REQUESTED = 'requested',
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
  ADMIN = 'admin',
}
