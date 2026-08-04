export enum RideStatus {
  SCHEDULED = 'scheduled',
  REQUESTED = 'requested',
  SEARCHING = 'searching',
  ACCEPTED = 'accepted',
  ARRIVING = 'arriving',
  ARRIVED = 'arrived',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
  NO_DRIVER_FOUND = 'no_driver_found',
}

export enum RideCategory {
  ECONOMY = 'economy',
  COMFORT = 'comfort',
  EXECUTIVE = 'executive',
  XL = 'xl',
  SUV = 'suv',
  ELECTRIC = 'electric',
  MOTORCYCLE = 'motorcycle',
  TRICYCLE = 'tricycle',
  TAXI = 'taxi',
  LUXURY = 'luxury',
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
