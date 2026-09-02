import { BadRequestException, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Audit } from '../audit/decorators/audit.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { RidesService } from './rides.service';
import { DispatchService } from '../dispatch/dispatch.service';
import { AutoDispatchService } from '../dispatch/auto-dispatch.service';
import { DispatchMode } from '../candidate-search/candidate-search.types';
import { RideStatus } from '../common/enums/ride.enum';

/**
 * Operational visibility and manual intervention for dispatch - not a
 * new dispatch implementation. Every mutating endpoint here reuses the
 * exact same, already-tested service methods the automatic system
 * itself uses (RidesService.acceptRide()'s atomic reservation,
 * DispatchService's offer bookkeeping, AutoDispatchService's own
 * candidate search) rather than a parallel path that could drift from
 * or bypass the safety guarantees those already provide.
 */
@ApiTags('admin-dispatch')
@ApiBearerAuth('access-token')
@Controller('admin/dispatch')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.DISPATCHER, UserRole.COUNTRY_ADMIN, UserRole.CITY_MANAGER)
export class AdminDispatchController {
  constructor(
    private readonly ridesService: RidesService,
    private readonly dispatchService: DispatchService,
    private readonly autoDispatchService: AutoDispatchService,
  ) {}

  @ApiOperation({
    summary: "A ride's full dispatch history",
    description: 'Every driver ever offered this ride and what happened to that offer, oldest first.',
  })
  @Get(':rideId/timeline')
  async timeline(@Param('rideId') rideId: string) {
    return this.dispatchService.getDispatchTimeline(rideId);
  }

  @ApiOperation({
    summary: 'Who is eligible for this ride right now',
    description:
      "Re-runs the live eligibility search this ride's own dispatch uses, live - not a stored snapshot. Read-only; does not create an offer.",
  })
  @Get(':rideId/candidates')
  async candidates(@Param('rideId') rideId: string) {
    const ride = await this.ridesService.findById(rideId);
    return this.dispatchService.getCandidatesForRide(ride);
  }

  @ApiOperation({
    summary: 'Manually assign a specific driver to this ride',
    description:
      'Withdraws any currently-pending offer first, then reserves the driver through the same atomic path a normal driver acceptance uses - so this can never double-book a driver or bypass the reservation safety.',
  })
  @Patch(':rideId/assign/:driverUserId')
  @Audit('dispatch.manual_assign')
  async assign(@Param('rideId') rideId: string, @Param('driverUserId') driverUserId: string) {
    await this.dispatchService.adminCancelOffer(rideId);
    return this.ridesService.acceptRide(rideId, driverUserId);
  }

  @ApiOperation({
    summary: "Cancel whoever's currently pending offer on this ride, without cancelling the ride itself",
  })
  @Patch(':rideId/cancel-offer')
  @Audit('dispatch.cancel_offer')
  async cancelOffer(@Param('rideId') rideId: string) {
    await this.dispatchService.adminCancelOffer(rideId);
    return { cancelled: true };
  }

  @ApiOperation({
    summary: 'Restart dispatch for a ride stuck without a driver',
    description:
      'Only valid from NO_DRIVER_FOUND or SEARCHING - resets to SEARCHING (via the same admin force-status path used elsewhere) and, for an AUTO-mode ride, immediately re-triggers the automatic offer pipeline rather than waiting for the next event. A MANUAL-mode ride is left at SEARCHING for the passenger to pick someone themselves, same as it already works.',
  })
  @Patch(':rideId/re-dispatch')
  @Audit('dispatch.re_dispatch')
  async redispatch(@Param('rideId') rideId: string) {
    const ride = await this.ridesService.findById(rideId);
    if (ride.status !== RideStatus.NO_DRIVER_FOUND && ride.status !== RideStatus.SEARCHING) {
      throw new BadRequestException(
        `Cannot re-dispatch a ride in status '${ride.status}' - only NO_DRIVER_FOUND or SEARCHING.`,
      );
    }

    if (ride.status !== RideStatus.SEARCHING) {
      await this.ridesService.forceStatusForAdmin(rideId, RideStatus.SEARCHING);
    }

    if (ride.dispatchMode === DispatchMode.AUTO) {
      await this.autoDispatchService.startForRide(rideId);
    }

    return this.ridesService.findById(rideId);
  }
}
