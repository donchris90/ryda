export enum UserRole {
  PASSENGER = 'passenger',
  DRIVER = 'driver',
  ADMIN = 'admin',
  SUPER_ADMIN = 'super_admin',
  DISPATCHER = 'dispatcher',
  FLEET_OWNER = 'fleet_owner',
  CORPORATE = 'corporate',
  COUNTRY_ADMIN = 'country_admin',
  CITY_MANAGER = 'city_manager',
  SUPPORT_AGENT = 'support_agent',
  FINANCE = 'finance',
  MARKETING = 'marketing',
  AUDITOR = 'auditor',
}

/**
 * Roles that should be treated as having admin-equivalent reach for
 * broad guards (e.g. viewing all payments/rides). Specific endpoints can
 * still require a narrower role via @Roles(...) when it matters (e.g. only
 * FINANCE can issue refunds).
 */
export const ADMIN_LIKE_ROLES = [
  UserRole.ADMIN,
  UserRole.SUPER_ADMIN,
  UserRole.COUNTRY_ADMIN,
  UserRole.CITY_MANAGER,
];

/**
 * Who counts as "operations personnel" for safety-critical alerts
 * (SOS, incident escalation) and who can actually act on an incident
 * (view/acknowledge/respond/escalate/resolve in EmergencyController) -
 * deliberately the same list for both, so nobody who can act is left
 * un-notified, and nobody who's notified is unable to act.
 */
export const SAFETY_OPS_ROLES = [...ADMIN_LIKE_ROLES, UserRole.DISPATCHER, UserRole.SUPPORT_AGENT];

/**
 * The only roles a public, unauthenticated POST /auth/register call
 * may ever create - everything else (ADMIN, SUPER_ADMIN, DISPATCHER,
 * COUNTRY_ADMIN, CITY_MANAGER, SUPPORT_AGENT, FINANCE, MARKETING,
 * AUDITOR) is staff access and must only ever be provisioned by an
 * existing admin or the seed-admin CLI script (see src/scripts/) -
 * never by whoever happens to POST a role value in a public signup
 * form. FLEET_OWNER and CORPORATE are both legitimate public
 * self-signups (a business registering itself), same as PASSENGER
 * and DRIVER.
 */
export const SELF_REGISTERABLE_ROLES = [
  UserRole.PASSENGER,
  UserRole.DRIVER,
  UserRole.CORPORATE,
  UserRole.FLEET_OWNER,
];
