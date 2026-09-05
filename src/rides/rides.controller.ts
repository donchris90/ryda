import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { User } from '../users/entities/user.entity';
import { RidesService } from './rides.service';
import { DispatchService } from '../dispatch/dispatch.service';
import { FareEstimateDto } from './dto/fare-estimate.dto';
import { RequestRideDto } from './dto/request-ride.dto';
import { CancelRideDto, AdminCancelRideDto } from './dto/cancel-ride.dto';
import { RateRideDto } from './dto/rate-ride.dto';
import { SelectDriverDto } from './dto/select-driver.dto';
import { CancelledBy, RideStatus } from '../common/enums/ride.enum';
import { SAFETY_OPS_ROLES, ADMIN_LIKE_ROLES } from '../common/enums/user-role.enum';
import { AddTipDto, VerifyPinDto } from './dto/tip-and-pin.dto';
import { Audit } from '../audit/decorators/audit.decorator';

@ApiTags('rides')
@ApiBearerAuth('access-token')
@Controller('rides')
export class RidesController {
  constructor(
    private readonly ridesService: RidesService,
    private readonly dispatchService: DispatchService,
  ) {}

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

  /**
   * Blunt, admin-only escape hatch for a ride genuinely stuck in an
   * inconsistent state (e.g. from the completion bug fixed elsewhere in
   * this file — a ride that should have reverted but didn't, from
   * before that fix was deployed). Not a normal business operation;
   * this is specifically for manually recovering broken data, so it
   * intentionally does nothing beyond changing the status — no refund
   * logic, no notification, no side effects. Whoever uses this is
   * expected to already know why the ride is stuck and what (if
   * anything) needs to happen with any related payment separately.
   */
  @Patch('admin/:id/force-status/:status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Audit('ride.force_status')
  forceStatus(@Param('id') id: string, @Param('status') status: RideStatus) {
    return this.ridesService.forceStatusForAdmin(id, status);
  }

  @Delete('admin/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Audit('ride.delete')
  deleteRide(@Param('id') id: string) {
    return this.ridesService.deleteForAdmin(id);
  }

  /**
   * Everything a support/ops admin needs to understand one ride
   * without jumping between the drivers, users, and payments pages —
   * full ride record plus passenger/driver/vehicle/payment context in
   * one call. Read-only, so no @Audit here - viewing isn't a
   * sensitive action the way changing something is.
   */
  @Get('admin/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...SAFETY_OPS_ROLES, UserRole.FINANCE, UserRole.AUDITOR)
  getForAdmin(@Param('id') id: string) {
    return this.ridesService.getForAdmin(id);
  }

  /** Dispatch timeline for this ride - every offer made, to whom, and how it resolved. */
  @Get('admin/:id/dispatch-timeline')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...SAFETY_OPS_ROLES, UserRole.AUDITOR)
  getDispatchTimeline(@Param('id') id: string) {
    return this.dispatchService.getOffersForRideAdmin(id);
  }

  /**
   * Re-runs dispatch for a ride that's stuck SEARCHING or ended up
   * NO_DRIVER_FOUND - the same candidate-search-and-offer pipeline a
   * fresh ride request kicks off, not a special admin-only algorithm.
   * Refuses anything already past that point (accepted, in progress,
   * completed, cancelled) rather than silently no-op'ing, so an admin
   * gets a clear reason instead of wondering why nothing happened.
   */
  @Post('admin/:id/redispatch')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...SAFETY_OPS_ROLES)
  @Audit('ride.redispatch')
  redispatch(@Param('id') id: string) {
    return this.dispatchService.redispatchForAdmin(id);
  }

  /**
   * Bypasses the normal offer-and-accept flow entirely and assigns a
   * specific driver directly - for the cases automated dispatch
   * genuinely can't handle well (a VIP pickup, a driver who called in
   * about a ride the app isn't offering them, etc.). Because it skips
   * the driver's own acceptance, this is deliberately a narrower role
   * set than redispatch (which still asks a driver to accept).
   */
  @Post('admin/:id/assign/:driverUserId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ADMIN_LIKE_ROLES, UserRole.DISPATCHER)
  @Audit('ride.manual_assign')
  manualAssign(@Param('id') id: string, @Param('driverUserId') driverUserId: string) {
    return this.ridesService.manualAssignForAdmin(id, driverUserId);
  }

  /**
   * Admin/support cancellation - distinct from the passenger/driver
   * self-service :id/cancel above so it's attributed accurately
   * (CancelledBy.ADMIN, not misattributed as the passenger cancelling
   * themselves) and never charges the passenger a cancellation fee,
   * which cancelRide() already only applies for CancelledBy.PASSENGER.
   * A reason is required here, unlike the optional one on self-service
   * cancellation - an admin overriding a ride needs to leave a record
   * of why, for whoever looks at this ride's audit trail later.
   */
  @Patch('admin/:id/cancel')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...SAFETY_OPS_ROLES)
  @Audit('ride.admin_cancel')
  adminCancel(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: AdminCancelRideDto) {
    return this.ridesService.cancelRide(id, user.id, CancelledBy.ADMIN, dto);
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

  @Get(':id/pool-manifest')
  @UseGuards(JwtAuthGuard)
  getPoolManifest(@Param('id') id: string, @CurrentUser() user: User) {
    return this.ridesService.getPoolManifest(id, user.id, user.role);
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

  /**
   * The passenger-facing equivalent, with what a passenger actually
   * needs to choose someone — name, vehicle, ETA — not the bare
   * ops-console shape above.
   */
  @Get(':id/selectable-drivers')
  @UseGuards(JwtAuthGuard)
  selectableDrivers(@Param('id') id: string) {
    return this.ridesService.findSelectableDrivers(id);
  }

  @Post(':id/select-driver')
  @UseGuards(JwtAuthGuard)
  selectDriver(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: SelectDriverDto) {
    return this.ridesService.selectDriver(id, user.id, dto.driverUserId);
  }

  @Patch(':id/current-offer/withdraw')
  @UseGuards(JwtAuthGuard)
  withdrawCurrentOffer(@CurrentUser() user: User, @Param('id') id: string) {
    return this.ridesService.withdrawCurrentOffer(id, user.id);
  }

  /**
   * Lets the passenger's app know whether there's currently a live
   * offer out (and to render a waiting/countdown state) or whether it
   * should show the driver list again — the ride's own status alone
   * doesn't distinguish these, since it stays SEARCHING through the
   * whole select → wait → maybe-expire → select-again cycle.
   */
  @Get(':id/current-offer')
  @UseGuards(JwtAuthGuard)
  currentOffer(@Param('id') id: string) {
    return this.dispatchService.getPendingOfferForRide(id);
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
