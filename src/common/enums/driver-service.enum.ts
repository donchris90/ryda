import { DriverAvailability } from './driver-status.enum';

/**
 * A service a driver can be approved to provide. Deliberately separate
 * from both DriverProfile.availability (what they're accepting *right
 * now*) and Vehicle.category (what they physically drive) — see
 * DriverServiceCapability for the persistent "driver requested/is
 * approved for this service" record.
 */
export enum DriverService {
  RIDE = 'ride',
  DELIVERY = 'delivery',
}

/**
 * PENDING = driver requested this service at registration (or later);
 * APPROVED = an admin has authorized them to provide it; REJECTED = an
 * admin declined it. A driver can never set this to APPROVED
 * themselves — see DriversService.requestServices() vs
 * DriversService.decideServiceCapability().
 */
export enum ServiceApprovalStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

const ONLINE_STATES_BY_SERVICE: Record<DriverService, DriverAvailability[]> = {
  [DriverService.RIDE]: [DriverAvailability.ONLINE_FOR_RIDES, DriverAvailability.ONLINE_FOR_BOTH],
  [DriverService.DELIVERY]: [DriverAvailability.ONLINE_FOR_DELIVERIES, DriverAvailability.ONLINE_FOR_BOTH],
};

/** Which `availability` values count as "currently online for this service". */
export function onlineAvailabilitiesForService(service: DriverService): DriverAvailability[] {
  return ONLINE_STATES_BY_SERVICE[service];
}

/** True if the given availability value means "currently online for `service`". */
export function isOnlineForService(availability: DriverAvailability, service: DriverService): boolean {
  return ONLINE_STATES_BY_SERVICE[service].includes(availability);
}

/**
 * Given the set of services a driver just picked to be online for
 * (e.g. from the "What are you available for?" screen), resolves the
 * single `DriverAvailability` value that represents it. Throws on an
 * empty set — "go online for nothing" isn't a valid selection.
 */
export function resolveOnlineAvailability(services: DriverService[]): DriverAvailability {
  const wantsRide = services.includes(DriverService.RIDE);
  const wantsDelivery = services.includes(DriverService.DELIVERY);
  if (wantsRide && wantsDelivery) return DriverAvailability.ONLINE_FOR_BOTH;
  if (wantsRide) return DriverAvailability.ONLINE_FOR_RIDES;
  if (wantsDelivery) return DriverAvailability.ONLINE_FOR_DELIVERIES;
  throw new Error('At least one service must be selected to go online');
}
