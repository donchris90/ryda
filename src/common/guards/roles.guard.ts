import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { UserRole } from '../enums/user-role.enum';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const { user } = context.switchToHttp().getRequest();
    // A user can hold multiple roles (e.g. passenger + driver on one
    // account) — pass if ANY of their roles satisfies the requirement.
    // Falls back to the single `role` field for safety if `roles` is
    // ever missing (e.g. a stale cached object).
    const userRoles: string[] = user?.roles ?? (user?.role ? [user.role] : []);
    return requiredRoles.some((r) => userRoles.includes(r));
  }
}
