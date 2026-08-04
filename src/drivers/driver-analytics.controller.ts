import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { User } from '../users/entities/user.entity';
import { DriverAnalyticsService } from './driver-analytics.service';

@Controller('drivers')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.DRIVER)
export class DriverAnalyticsController {
  constructor(private readonly analyticsService: DriverAnalyticsService) {}

  @Get('shifts/current')
  getCurrentShift(@CurrentUser() user: User) {
    return this.analyticsService.getCurrentShift(user.id);
  }

  @Get('shifts/history')
  getShiftHistory(@CurrentUser() user: User, @Query('limit') limit?: string) {
    return this.analyticsService.getShiftHistory(user.id, limit ? parseInt(limit, 10) : undefined);
  }

  @Get('analytics/summary')
  getSummary(@CurrentUser() user: User, @Query('from') from?: string, @Query('to') to?: string) {
    return this.analyticsService.getSummary(user.id, from ? new Date(from) : undefined, to ? new Date(to) : undefined);
  }
}
