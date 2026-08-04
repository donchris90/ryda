import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, tap } from 'rxjs';
import { AUDIT_ACTION_KEY } from './decorators/audit.decorator';
import { AuditService } from './audit.service';

const SENSITIVE_BODY_FIELDS = ['password', 'refreshToken'];

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly auditService: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const action = this.reflector.get<string>(AUDIT_ACTION_KEY, context.getHandler());
    if (!action) return next.handle();

    const request = context.switchToHttp().getRequest();

    return next.handle().pipe(
      tap(() => {
        // Fire-and-forget — an audit log write should never fail the request.
        this.auditService
          .log({
            actorUserId: request.user?.id ?? null,
            actorRole: request.user?.role ?? null,
            action,
            targetType: this.inferTargetType(action),
            targetId: this.inferTargetId(request),
            metadata: this.sanitizeBody(request.body),
            ipAddress: request.ip,
          })
          .catch(() => undefined);
      }),
    );
  }

  private inferTargetType(action: string): string {
    return action.split('.')[0];
  }

  private inferTargetId(request: any): string | null {
    const params = request.params ?? {};
    return params.id ?? params.driverId ?? params.userId ?? params.rideId ?? null;
  }

  private sanitizeBody(body: unknown): Record<string, unknown> | undefined {
    if (!body || typeof body !== 'object') return undefined;
    const clone: Record<string, unknown> = { ...(body as Record<string, unknown>) };
    for (const field of SENSITIVE_BODY_FIELDS) {
      if (field in clone) clone[field] = '[redacted]';
    }
    return clone;
  }
}
