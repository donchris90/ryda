import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { AnalyticsService } from './analytics.service';

@Controller('admin/analytics')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.FINANCE, UserRole.AUDITOR)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('overview')
  overview() {
    return this.analyticsService.getOverview();
  }

  @Get('revenue')
  revenue(@Query('groupBy') groupBy?: 'day' | 'week' | 'month') {
    return this.analyticsService.getRevenueTimeSeries(groupBy ?? 'day');
  }

  @Get('rides-by-status')
  ridesByStatus() {
    return this.analyticsService.getRidesByStatus();
  }

  @Get('top-drivers')
  topDrivers(@Query('limit') limit?: string) {
    return this.analyticsService.getTopDrivers(
      limit ? parseInt(limit, 10) : undefined,
    );
  }

  @Get('heatmap')
  heatmap() {
    return this.analyticsService.getPickupHeatmap();
  }

  @Get('trips-trend')
  tripsTrend(@Query('groupBy') groupBy?: 'day' | 'week' | 'month') {
    return this.analyticsService.getTripsTrend(groupBy ?? 'day');
  }

  @Get('cancellation-rate')
  cancellationRate(@Query('groupBy') groupBy?: 'day' | 'week' | 'month') {
    return this.analyticsService.getCancellationRateTrend(groupBy ?? 'day');
  }

  @Get('peak-hours')
  peakHours() {
    return this.analyticsService.getPeakHours();
  }

  @Get('by-city')
  byCity() {
    return this.analyticsService.getByCity();
  }

  @Get('by-vehicle-category')
  byVehicleCategory() {
    return this.analyticsService.getByVehicleCategory();
  }

  @Get('growth')
  growth(@Query('groupBy') groupBy?: 'day' | 'week' | 'month') {
    return this.analyticsService.getGrowth(groupBy ?? 'day');
  }

  @Get('active-users')
  activeUsers(@Query('groupBy') groupBy?: 'day' | 'week' | 'month') {
    return this.analyticsService.getActiveUsers(groupBy ?? 'day');
  }

  @Get('pooling-overview')
  poolingOverview() {
    return this.analyticsService.getPoolingOverview();
  }

  @Get('pooling-trend')
  poolingTrend(@Query('groupBy') groupBy?: 'day' | 'week' | 'month') {
    return this.analyticsService.getPoolingTrend(groupBy ?? 'day');
  }
}
