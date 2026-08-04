import { CanActivate, ExecutionContext, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { SystemSettingsService, SETTING_KEYS } from '../settings/settings.service';

// Always reachable even during maintenance: health checks (so the LB/k8s
// doesn't consider the app itself down), auth (so admins can still log in
// to turn maintenance mode back off), and every admin/ops path.
const ALWAYS_ALLOWED_PREFIXES = ['/api/v1/health', '/api/v1/metrics', '/api/v1/auth', '/api/v1/admin'];

@Injectable()
export class MaintenanceModeGuard implements CanActivate {
  constructor(private readonly settingsService: SystemSettingsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const path: string = request.originalUrl ?? request.url ?? '';

    if (ALWAYS_ALLOWED_PREFIXES.some((prefix) => path.startsWith(prefix))) return true;

    const inMaintenance = await this.settingsService.getBoolean(SETTING_KEYS.MAINTENANCE_MODE, false);
    if (inMaintenance) {
      throw new ServiceUnavailableException(
        'Ryda is temporarily down for maintenance. Please try again shortly.',
      );
    }
    return true;
  }
}
