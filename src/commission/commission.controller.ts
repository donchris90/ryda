import { Body, Controller, Delete, Get, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { CommissionService } from './commission.service';
import { CommissionRule } from './entities/commission-rule.entity';
import { DriverLevel } from '../common/enums/driver-level.enum';
import { Audit } from '../audit/decorators/audit.decorator';
import { RequirePermission } from '../common/permissions/require-permission.decorator';
import { PermissionsGuard } from '../common/permissions/permissions.guard';
import { Permission } from '../common/permissions/permission.enum';

@Controller('admin/commission-rules')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.ADMIN, UserRole.COUNTRY_ADMIN, UserRole.SUPER_ADMIN)
export class CommissionController {
  constructor(private readonly commissionService: CommissionService) {}

  @Get()
  list() {
    return this.commissionService.listRules();
  }

  @Post()
  @RequirePermission(Permission.COMMISSION_MANAGE)
  @Audit('commission_rule.create')
  create(@Body() body: Partial<CommissionRule>) {
    return this.commissionService.createRule(body);
  }

  // Real gap this fixes: only create existed before - an admin could
  // never actually edit or remove a rule once made, only add more.
  @Patch(':id')
  @RequirePermission(Permission.COMMISSION_MANAGE)
  @Audit('commission_rule.update')
  update(@Param('id') id: string, @Body() body: Partial<CommissionRule>) {
    return this.commissionService.updateRule(id, body);
  }

  @Delete(':id')
  @RequirePermission(Permission.COMMISSION_MANAGE)
  @Audit('commission_rule.delete')
  remove(@Param('id') id: string) {
    return this.commissionService.deleteRule(id);
  }

  // Real gap this fixes: the platform-wide default commission per
  // driver level was a hardcoded constant with no admin-editable path
  // at all - changing it required a code deploy.
  @Get('defaults/by-level')
  getDefaults() {
    return this.commissionService.getDefaultsByLevel();
  }

  @Put('defaults/:level')
  @RequirePermission(Permission.COMMISSION_MANAGE)
  @Audit('commission_default.update')
  setDefault(@CurrentUser() admin: User, @Param('level') level: DriverLevel, @Body('percent') percent: number) {
    return this.commissionService.setDefaultForLevel(level, percent, admin.id);
  }
}
