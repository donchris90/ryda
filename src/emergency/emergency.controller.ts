import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole, SAFETY_OPS_ROLES } from '../common/enums/user-role.enum';
import { User } from '../users/entities/user.entity';
import { EmergencyService } from './emergency.service';
import { SafetyMonitoringService } from './safety-monitoring.service';
import { SafetyRecordingsService } from './safety-recordings.service';
import { RiskAlertStatus } from './entities/risk-alert.entity';
import {
  AddIncidentNoteDto,
  EscalateIncidentDto,
  ForceCancelRideDto,
  ReportIncidentDto,
  RespondIncidentDto,
  ResolveIncidentDto,
  ReviewRiskAlertDto,
} from './dto/emergency.dto';
import { Audit } from '../audit/decorators/audit.decorator';

const RESPONDER_ROLES = SAFETY_OPS_ROLES;

@ApiTags('emergency')
@Controller()
@UseGuards(JwtAuthGuard)
export class EmergencyController {
  constructor(
    private readonly emergencyService: EmergencyService,
    private readonly safetyMonitoringService: SafetyMonitoringService,
    private readonly safetyRecordingsService: SafetyRecordingsService,
  ) {}

  @Post('emergency/sos')
  @Audit('emergency.sos_triggered')
  triggerSos(
    @CurrentUser() user: User,
    @Body() body: { rideId?: string; lat?: number; lng?: number },
  ) {
    return this.emergencyService.triggerSos(user.id, body.rideId, body.lat, body.lng);
  }

  @Get('emergency/incidents/mine')
  listMine(@CurrentUser() user: User) {
    return this.emergencyService.listMine(user.id);
  }

  @Post('emergency/incidents')
  reportIncident(@CurrentUser() user: User, @Body() dto: ReportIncidentDto) {
    return this.emergencyService.reportIncident(user.id, dto);
  }

  @Get('emergency/incidents/:id/timeline')
  timeline(@Param('id') id: string) {
    return this.emergencyService.getTimeline(id);
  }

  @Post('emergency/incidents/:id/recording')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 40 * 1024 * 1024 }, // matches MAX_UPLOAD_BYTES_BY_FOLDER['safety-recordings'] in storage.service.ts
    }),
  )
  uploadRecording(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Query('durationSeconds') durationSeconds?: string,
  ) {
    return this.safetyRecordingsService.uploadRecording(
      id,
      user.id,
      { buffer: file.buffer, originalname: file.originalname, mimetype: file.mimetype },
      durationSeconds ? parseInt(durationSeconds, 10) : undefined,
    );
  }

  /**
   * Returns a short-lived signed URL (or, for the local-disk driver in
   * dev, streams the bytes directly) rather than the recording's own
   * audioUrl field - that field is a plain, permanently-guessable link
   * with no access control of its own (see StorageService.getSignedReadUrl's
   * own comment), so the only place a caller should ever actually
   * reach the audio is through this endpoint, after canAccess() has
   * already run.
   */
  @Get('emergency/incidents/:id/recording')
  async getRecording(@CurrentUser() user: User, @Param('id') id: string, @Res() res: Response) {
    const recording = await this.safetyRecordingsService.getRecording(id, user.id, user.role);
    const signedUrl = await this.safetyRecordingsService.getSignedUrl(recording);
    if (signedUrl) {
      res.redirect(signedUrl);
      return;
    }
    const buffer = await this.safetyRecordingsService.readBytes(recording);
    res.setHeader('Content-Type', 'audio/mp4');
    res.send(buffer);
  }

  @Post('emergency/incidents/:id/notes')
  addNote(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: AddIncidentNoteDto) {
    return this.emergencyService.addTimelineEntry(id, user.id, 'note', dto.note);
  }

  @Patch('emergency/incidents/:id/cancel')
  @Audit('emergency.incident.cancel')
  cancelIncident(@CurrentUser() user: User, @Param('id') id: string) {
    return this.emergencyService.cancelIncident(id, user.id);
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

  @Patch('admin/emergency/incidents/:id/respond')
  @UseGuards(RolesGuard)
  @Roles(...RESPONDER_ROLES)
  @Audit('emergency.incident.respond')
  respond(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: RespondIncidentDto) {
    return this.emergencyService.respond(id, user.id, dto.notes);
  }

  @Patch('admin/emergency/incidents/:id/escalate')
  @UseGuards(RolesGuard)
  @Roles(...RESPONDER_ROLES)
  @Audit('emergency.incident.escalate')
  escalate(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: EscalateIncidentDto) {
    return this.emergencyService.escalate(id, user.id, dto.reason);
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

  // ---- Live safety monitoring (risk alerts) ----

  @Get('admin/emergency/risk-alerts')
  @UseGuards(RolesGuard)
  @Roles(...RESPONDER_ROLES)
  listOpenRiskAlerts() {
    return this.safetyMonitoringService.listOpenAlerts();
  }

  @Get('emergency/rides/:rideId/risk-alerts')
  @UseGuards(RolesGuard)
  @Roles(...RESPONDER_ROLES)
  listRiskAlertsForRide(@Param('rideId') rideId: string) {
    return this.safetyMonitoringService.listForRide(rideId);
  }

  @Patch('admin/emergency/risk-alerts/:id/review')
  @UseGuards(RolesGuard)
  @Roles(...RESPONDER_ROLES)
  @Audit('emergency.risk_alert.review')
  reviewRiskAlert(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: ReviewRiskAlertDto) {
    return this.safetyMonitoringService.review(id, user.id, RiskAlertStatus.REVIEWED, dto.notes);
  }

  @Patch('admin/emergency/risk-alerts/:id/dismiss')
  @UseGuards(RolesGuard)
  @Roles(...RESPONDER_ROLES)
  @Audit('emergency.risk_alert.dismiss')
  dismissRiskAlert(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: ReviewRiskAlertDto) {
    return this.safetyMonitoringService.review(id, user.id, RiskAlertStatus.DISMISSED, dto.notes);
  }
}
