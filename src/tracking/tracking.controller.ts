import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { User } from '../users/entities/user.entity';
import { HistoryService } from './history.service';
import { LiveTrackingService } from './live-tracking.service';

@Controller('tracking')
@UseGuards(JwtAuthGuard)
export class TrackingController {
  constructor(
    private readonly historyService: HistoryService,
    private readonly liveTrackingService: LiveTrackingService,
  ) {}

  /**
   * Snapshot of everything currently on the road: active rides (with the
   * driver's last-known position) plus online drivers not yet on a ride.
   * Used to paint the admin live map on first load; the tracking gateway's
   * `admin:live` room takes over from there for real-time movement so this
   * doesn't need to be polled on a tight interval.
   */
  @Get('admin/live')
  @UseGuards(RolesGuard)
  @Roles(
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN,
    UserRole.COUNTRY_ADMIN,
    UserRole.CITY_MANAGER,
    UserRole.DISPATCHER,
  )
  adminLive(@Query('city') city?: string) {
    return this.liveTrackingService.getLiveSnapshot(city);
  }

  /** Delivery equivalent of GET admin/live above - see getLiveDeliveriesSnapshot() doc comment. */
  @Get('admin/live-deliveries')
  @UseGuards(RolesGuard)
  @Roles(
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN,
    UserRole.COUNTRY_ADMIN,
    UserRole.CITY_MANAGER,
    UserRole.DISPATCHER,
  )
  adminLiveDeliveries(@Query('city') city?: string) {
    return this.liveTrackingService.getLiveDeliveriesSnapshot(city);
  }

  @Get('rides/:id/route')
  rideRoute(@Param('id') rideId: string) {
    return this.historyService.getRideRoute(rideId);
  }

  @Get('drivers/me/history')
  @UseGuards(RolesGuard)
  @Roles(UserRole.DRIVER)
  myHistory(
    @CurrentUser() user: User,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const toDate = to ? new Date(to) : new Date();
    const fromDate = from
      ? new Date(from)
      : new Date(toDate.getTime() - 24 * 60 * 60 * 1000);
    return this.historyService.getDriverHistory(user.id, fromDate, toDate);
  }
}
