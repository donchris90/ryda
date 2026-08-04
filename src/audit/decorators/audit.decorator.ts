import { SetMetadata } from '@nestjs/common';

export const AUDIT_ACTION_KEY = 'audit_action';

/** Marks a route handler for automatic audit logging by AuditInterceptor. */
export const Audit = (action: string) => SetMetadata(AUDIT_ACTION_KEY, action);
