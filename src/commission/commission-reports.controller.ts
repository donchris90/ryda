import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { CommissionService } from './commission.service';

@Controller('admin/commission/reports')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.COUNTRY_ADMIN, UserRole.SUPER_ADMIN, UserRole.FINANCE)
export class CommissionReportsController {
  constructor(private readonly commissionService: CommissionService) {}

  @Get('summary')
  summary(@Query('from') from?: string, @Query('to') to?: string) {
    return this.commissionService.getSummary(from ? new Date(from) : undefined, to ? new Date(to) : undefined);
  }

  @Get('by-driver')
  byDriver(@Query('from') from?: string, @Query('to') to?: string, @Query('limit') limit?: string) {
    return this.commissionService.getByDriver(
      from ? new Date(from) : undefined,
      to ? new Date(to) : undefined,
      limit ? parseInt(limit, 10) : undefined,
    );
  }
}
