import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { User } from '../users/entities/user.entity';
import { HistoryService } from './history.service';

@Controller('tracking')
@UseGuards(JwtAuthGuard)
export class TrackingController {
  constructor(private readonly historyService: HistoryService) {}

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
    const fromDate = from ? new Date(from) : new Date(toDate.getTime() - 24 * 60 * 60 * 1000);
    return this.historyService.getDriverHistory(user.id, fromDate, toDate);
  }
}
