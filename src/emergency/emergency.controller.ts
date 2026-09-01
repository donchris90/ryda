import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { User } from '../users/entities/user.entity';
import { EmergencyService } from './emergency.service';
import {
  AddIncidentNoteDto,
  ForceCancelRideDto,
  ReportIncidentDto,
  ResolveIncidentDto,
} from './dto/emergency.dto';
import { Audit } from '../audit/decorators/audit.decorator';
import { RESPONDER_ROLES } from '../common/constants/responder-roles';

@ApiTags('emergency')
@Controller()
@UseGuards(JwtAuthGuard)
export class EmergencyController {
  constructor(private readonly emergencyService: EmergencyService) {}

  @Post('emergency/sos')
  @Audit('emergency.sos_triggered')
  triggerSos(
    @CurrentUser() user: User,
    @Body() body: { rideId?: string; lat?: number; lng?: number },
  ) {
    return this.emergencyService.triggerSos(user.id, body.rideId, body.lat, body.lng);
  }

  @Post('emergency/incidents')
  reportIncident(@CurrentUser() user: User, @Body() dto: ReportIncidentDto) {
    return this.emergencyService.reportIncident(user.id, dto);
  }

  // IDOR fix (batch 12): these used to call the service with just the
  // incident id — no ownership/role check — so any authenticated user
  // could read or write into any incident's timeline by guessing its id.
  // Scoped now to the reporter, a party on the linked ride, or staff (see
  // EmergencyService.assertCanAccess).
  @Get('emergency/incidents/:id/timeline')
  timeline(@CurrentUser() user: User, @Param('id') id: string) {
    return this.emergencyService.getTimelineForRequester(id, user.id, user.roles ?? [user.role]);
  }

  @Post('emergency/incidents/:id/notes')
  addNote(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: AddIncidentNoteDto) {
    return this.emergencyService.addNoteAsRequester(id, user.id, user.roles ?? [user.role], dto.note);
  }

  // ---- Admin/support command center ----

  @Get('admin/emergency/incidents/active')
  @UseGuards(RolesGuard)
  @Roles(...RESPONDER_ROLES)
  listActive() {
    return this.emergencyService.listActive();
  }

  @Get('admin/emergency/incidents')
  @UseGuards(RolesGuard)
  @Roles(...RESPONDER_ROLES)
  listAll() {
    return this.emergencyService.listAll();
  }

  @Patch('admin/emergency/incidents/:id/acknowledge')
  @UseGuards(RolesGuard)
  @Roles(...RESPONDER_ROLES)
  @Audit('emergency.incident.acknowledge')
  acknowledge(@CurrentUser() user: User, @Param('id') id: string) {
    return this.emergencyService.acknowledge(id, user.id);
  }

  @Patch('admin/emergency/incidents/:id/resolve')
  @UseGuards(RolesGuard)
  @Roles(...RESPONDER_ROLES)
  @Audit('emergency.incident.resolve')
  resolve(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: ResolveIncidentDto) {
    return this.emergencyService.resolve(id, user.id, dto.notes);
  }

  @Get('admin/emergency/live-rides')
  @UseGuards(RolesGuard)
  @Roles(...RESPONDER_ROLES)
  liveRides() {
    return this.emergencyService.getLiveRides();
  }

  @Post('admin/emergency/rides/:id/force-cancel')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Audit('emergency.ride.force_cancel')
  forceCancelRide(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: ForceCancelRideDto) {
    return this.emergencyService.forceCancelRide(id, user.id, dto.reason);
  }
}
