import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { User } from '../users/entities/user.entity';
import { AdminToolsService } from './admin-tools.service';
import { SetMaintenanceModeDto } from './dto/admin-tools.dto';
import { Audit } from '../audit/decorators/audit.decorator';

@Controller('admin/tools')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
export class AdminToolsController {
  constructor(private readonly adminToolsService: AdminToolsService) {}

  @Get('queues')
  queueStats() {
    return this.adminToolsService.getQueueStats();
  }

  @Post('cache/clear')
  @Audit('admin_tools.cache_clear')
  clearCache() {
    return this.adminToolsService.clearSettingsCache();
  }

  @Get('maintenance-mode')
  getMaintenanceMode() {
    return this.adminToolsService.getMaintenanceMode();
  }

  @Post('maintenance-mode')
  @Audit('admin_tools.maintenance_mode_change')
  setMaintenanceMode(@CurrentUser() user: User, @Body() dto: SetMaintenanceModeDto) {
    return this.adminToolsService.setMaintenanceMode(dto.enabled, user.id);
  }

  @Get('diagnostics')
  diagnostics() {
    return this.adminToolsService.getDiagnostics();
  }
}
