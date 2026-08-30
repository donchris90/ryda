import { UserRole } from '../enums/user-role.enum';

/**
 * Staff roles considered "on-call" for the Emergency Command Center —
 * who can see/act on incidents via EmergencyController, and (as of the
 * SOS escalation fix) who gets actively alerted the moment an SOS fires,
 * not just whoever happens to be polling the admin dashboard.
 *
 * Kept in one place so the two never drift apart — previously this list
 * only existed inline in emergency.controller.ts, and notifications.service.ts
 * had no way to know who counts as a responder.
 */
export const RESPONDER_ROLES = [
  UserRole.ADMIN,
  UserRole.SUPER_ADMIN,
  UserRole.SUPPORT_AGENT,
  UserRole.DISPATCHER,
];
