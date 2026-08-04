export enum Permission {
  // Users & trust/safety
  USERS_MANAGE = 'users.manage',
  PASSENGERS_BLACKLIST = 'passengers.blacklist',
  DRIVERS_APPROVE = 'drivers.approve',
  DRIVER_DOCUMENTS_REVIEW = 'driver_documents.review',

  // Money
  PAYMENTS_REFUND = 'payments.refund',
  PAYMENTS_VIEW_ALL = 'payments.view_all',
  COMMISSION_MANAGE = 'commission.manage',
  PROMOTIONS_MANAGE = 'promotions.manage',
  FLEET_VIEW_ALL = 'fleet.view_all',

  // Content & comms
  CMS_MANAGE = 'cms.manage',
  NOTIFICATIONS_BROADCAST = 'notifications.broadcast',
  ADS_MANAGE = 'ads.manage',

  // Support & safety
  SUPPORT_MANAGE_TICKETS = 'support.manage_tickets',
  FRAUD_REVIEW = 'fraud.review',

  // Platform
  AUDIT_LOGS_VIEW = 'audit_logs.view',
  ANALYTICS_VIEW = 'analytics.view',
}

/**
 * Data-driven role → permission matrix. This is the source of truth for
 * what each role can do; PermissionsGuard checks against this rather than
 * hardcoding logic per-endpoint. SUPER_ADMIN implicitly has everything
 * (checked separately in the guard) rather than being listed exhaustively
 * here.
 */
export const ROLE_PERMISSIONS: Record<string, Permission[]> = {
  admin: Object.values(Permission), // full access, same as super_admin in practice
  super_admin: Object.values(Permission),
  finance: [Permission.PAYMENTS_REFUND, Permission.PAYMENTS_VIEW_ALL, Permission.ANALYTICS_VIEW],
  auditor: [Permission.AUDIT_LOGS_VIEW, Permission.ANALYTICS_VIEW, Permission.PAYMENTS_VIEW_ALL],
  support_agent: [
    Permission.SUPPORT_MANAGE_TICKETS,
    Permission.PASSENGERS_BLACKLIST,
    Permission.FRAUD_REVIEW,
  ],
  marketing: [Permission.PROMOTIONS_MANAGE, Permission.CMS_MANAGE, Permission.NOTIFICATIONS_BROADCAST, Permission.ADS_MANAGE],
  country_admin: [
    Permission.DRIVERS_APPROVE,
    Permission.DRIVER_DOCUMENTS_REVIEW,
    Permission.COMMISSION_MANAGE,
    Permission.ANALYTICS_VIEW,
    Permission.FLEET_VIEW_ALL,
  ],
  city_manager: [Permission.DRIVERS_APPROVE, Permission.DRIVER_DOCUMENTS_REVIEW, Permission.ANALYTICS_VIEW],
  dispatcher: [Permission.ANALYTICS_VIEW],
};

export function getPermissionsForRole(role: string): Permission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}
