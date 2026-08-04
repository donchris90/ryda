export enum DriverApprovalStatus {
  PENDING = 'pending',
  UNDER_REVIEW = 'under_review',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  SUSPENDED = 'suspended',
}

export enum DriverAvailability {
  OFFLINE = 'offline',
  ONLINE = 'online',
  ON_TRIP = 'on_trip',
}

export enum KycStatus {
  NOT_STARTED = 'not_started',
  SUBMITTED = 'submitted',
  VERIFIED = 'verified',
  FAILED = 'failed',
}
