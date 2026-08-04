import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { CommissionService } from './commission.service';
import { CommissionRule } from './entities/commission-rule.entity';
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
}
