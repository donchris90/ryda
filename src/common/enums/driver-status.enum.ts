export enum DriverApprovalStatus {
  PENDING = 'pending',
  UNDER_REVIEW = 'under_review',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  SUSPENDED = 'suspended',
}

/**
 * `ONLINE` was a single flag meaning "accepting anything" - replaced with
 * three explicit "online for X" states so a driver's current willingness
 * to accept ride vs delivery jobs can differ from what they're approved
 * for (see DriverService / DriverServiceCapability). ON_TRIP and BREAK
 * are unchanged and remain domain-agnostic: a driver on a trip or break
 * isn't a candidate for anything regardless of which online state they
 * were in beforehand (see DriverProfile.lastOnlineAvailability, which
 * remembers that state so it can be restored once the trip ends).
 */
export enum DriverAvailability {
  OFFLINE = 'offline',
  ONLINE_FOR_RIDES = 'online_for_rides',
  ONLINE_FOR_DELIVERIES = 'online_for_deliveries',
  ONLINE_FOR_BOTH = 'online_for_both',
  ON_TRIP = 'on_trip',
  BREAK = 'break',
}

/** The three states that mean "reachable for dispatch of at least one service". */
export const ONLINE_AVAILABILITIES: DriverAvailability[] = [
  DriverAvailability.ONLINE_FOR_RIDES,
  DriverAvailability.ONLINE_FOR_DELIVERIES,
  DriverAvailability.ONLINE_FOR_BOTH,
];

export function isOnlineAvailability(availability?: DriverAvailability | null): boolean {
  return !!availability && ONLINE_AVAILABILITIES.includes(availability);
}

export enum KycStatus {
  NOT_STARTED = 'not_started',
  SUBMITTED = 'submitted',
  VERIFIED = 'verified',
  FAILED = 'failed',
}
