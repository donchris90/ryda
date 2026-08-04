import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { User } from '../users/entities/user.entity';
import { RidesService } from './rides.service';
import { FareEstimateDto } from './dto/fare-estimate.dto';
import { RequestRideDto } from './dto/request-ride.dto';
import { CancelRideDto } from './dto/cancel-ride.dto';
import { RateRideDto } from './dto/rate-ride.dto';
import { CancelledBy, RideStatus } from '../common/enums/ride.enum';
import { AddTipDto, VerifyPinDto } from './dto/tip-and-pin.dto';

@ApiTags('rides')
@ApiBearerAuth('access-token')
@Controller('rides')
export class RidesController {
  constructor(private readonly ridesService: RidesService) {}

  @ApiOperation({
    summary: 'Get a fare estimate',
    description:
      'Public — no login needed. Includes automatic surge (from AiModule.PricingService), night pricing, and airport surcharge if requested.',
  })
  // Public: people can see a fare estimate before creating an account.
  @Post('estimate')
  estimate(@Body() dto: FareEstimateDto) {
    return this.ridesService.estimateFare(dto);
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.PASSENGER)
  request(@CurrentUser() user: User, @Body() dto: RequestRideDto) {
    return this.ridesService.requestRide(user.id, dto);
  }

  @Get('mine')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.PASSENGER)
  mine(@CurrentUser() user: User) {
    return this.ridesService.findForPassenger(user.id);
  }

  @Get('scheduled/mine')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.PASSENGER)
  scheduledMine(@CurrentUser() user: User) {
    return this.ridesService.findScheduledForPassenger(user.id);
  }

  @Get('driver/mine')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.DRIVER)
  driverMine(@CurrentUser() user: User) {
    return this.ridesService.findForDriver(user.id);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  get(@Param('id') id: string, @CurrentUser() user: User) {
    return this.ridesService.getForUser(id, user.id, user.role);
  }

  @Get('admin/list')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.COUNTRY_ADMIN, UserRole.CITY_MANAGER, UserRole.SUPPORT_AGENT, UserRole.FINANCE, UserRole.AUDITOR)
  listForAdmin(
    @Query('status') status?: RideStatus,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.ridesService.listForAdmin(
      { status, search },
      page ? parseInt(page, 10) : undefined,
      limit ? parseInt(limit, 10) : undefined,
    );
  }

  @Get(':id/driver-info')
  @UseGuards(JwtAuthGuard)
  getDriverInfo(@Param('id') id: string, @CurrentUser() user: User) {
    return this.ridesService.getDriverInfo(id, user.id, user.role);
  }

  @Get(':id/passenger-info')
  @UseGuards(JwtAuthGuard)
  getPassengerInfo(@Param('id') id: string, @CurrentUser() user: User) {
    return this.ridesService.getPassengerInfo(id, user.id, user.role);
  }

  @Get(':id/route')
  @UseGuards(JwtAuthGuard)
  getRoute(@Param('id') id: string, @CurrentUser() user: User) {
    return this.ridesService.getRoute(id, user.id, user.role);
  }

  @Post(':id/share')
  @UseGuards(JwtAuthGuard)
  share(@Param('id') id: string, @CurrentUser() user: User) {
    return this.ridesService.getOrCreateShareToken(id, user.id);
  }

  // Deliberately public — this is the link a passenger shares with
  // someone who doesn't have a Ryda account. No JwtAuthGuard here.
  @Get('shared/:token')
  getShared(@Param('token') token: string) {
    return this.ridesService.getSharedRideView(token);
  }

  @Post(':id/verify-pin')
  @UseGuards(JwtAuthGuard)
  verifyPin(@Param('id') id: string, @CurrentUser() user: User, @Body() dto: VerifyPinDto) {
    return this.ridesService.verifyPin(id, user.id, dto.pin);
  }

  @Post(':id/tip')
  @UseGuards(JwtAuthGuard)
  addTip(@Param('id') id: string, @CurrentUser() user: User, @Body() dto: AddTipDto) {
    return this.ridesService.addTip(id, user.id, dto.amount);
  }

  @Get(':id/nearby-drivers')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  nearbyDrivers(@Param('id') id: string, @Query('radiusKm') radiusKm?: string) {
    return this.ridesService.findNearbyDrivers(id, radiusKm ? parseFloat(radiusKm) : undefined);
  }

  @Patch(':id/accept')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.DRIVER)
  accept(@CurrentUser() user: User, @Param('id') id: string) {
    return this.ridesService.acceptRide(id, user.id);
  }

  @Patch(':id/arrived')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.DRIVER)
  arrived(@CurrentUser() user: User, @Param('id') id: string) {
    return this.ridesService.markArrived(id, user.id);
  }

  @Patch(':id/start')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.DRIVER)
  start(@CurrentUser() user: User, @Param('id') id: string) {
    return this.ridesService.startRide(id, user.id);
  }

  @Patch(':id/complete')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.DRIVER)
  complete(@CurrentUser() user: User, @Param('id') id: string) {
    return this.ridesService.completeRide(id, user.id);
  }

  @Patch(':id/cancel')
  @UseGuards(JwtAuthGuard)
  cancel(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: CancelRideDto,
  ) {
    const cancelledBy =
      user.role === UserRole.DRIVER ? CancelledBy.DRIVER : CancelledBy.PASSENGER;
    return this.ridesService.cancelRide(id, user.id, cancelledBy, dto);
  }

  @Post(':id/rate/driver')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.PASSENGER)
  rateDriver(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: RateRideDto) {
    return this.ridesService.rateDriver(id, user.id, dto);
  }

  @Post(':id/rate/passenger')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.DRIVER)
  ratePassenger(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: RateRideDto) {
    return this.ridesService.ratePassenger(id, user.id, dto);
  }
}
