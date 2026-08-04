import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { User } from '../users/entities/user.entity';
import { DriversService } from './drivers.service';
import { DriverDocumentsService } from './driver-documents.service';
import { OnboardDriverDto } from './dto/onboard-driver.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { UploadDocumentDto, ReviewDocumentDto } from './dto/driver-document.dto';
import { DriverAvailability, DriverApprovalStatus } from '../common/enums/driver-status.enum';
import { Audit } from '../audit/decorators/audit.decorator';
import { RequirePermission } from '../common/permissions/require-permission.decorator';
import { PermissionsGuard } from '../common/permissions/permissions.guard';
import { Permission } from '../common/permissions/permission.enum';
import { PassengersService } from '../passengers/passengers.service';
import { CreateEmergencyContactDto } from '../passengers/dto/passengers.dto';

@Controller('drivers')
@UseGuards(JwtAuthGuard)
export class DriversController {
  constructor(
    private readonly driversService: DriversService,
    private readonly documentsService: DriverDocumentsService,
    private readonly passengersService: PassengersService,
  ) {}

  // ---- Emergency contacts ----
  // The passenger app already has this under /passengers/me/... — the
  // underlying entity and service were already keyed by plain userId,
  // not tied to PassengerProfile, so this reuses the exact same service
  // methods rather than duplicating the feature. Only the routes and
  // role restriction are new.

  @Get('me/emergency-contacts')
  @UseGuards(RolesGuard)
  @Roles(UserRole.DRIVER)
  listEmergencyContacts(@CurrentUser() user: User) {
    return this.passengersService.listEmergencyContacts(user.id);
  }

  @Post('me/emergency-contacts')
  @UseGuards(RolesGuard)
  @Roles(UserRole.DRIVER)
  addEmergencyContact(@CurrentUser() user: User, @Body() dto: CreateEmergencyContactDto) {
    return this.passengersService.addEmergencyContact(user.id, dto);
  }

  @Delete('me/emergency-contacts/:id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.DRIVER)
  removeEmergencyContact(@CurrentUser() user: User, @Param('id') id: string) {
    return this.passengersService.removeEmergencyContact(user.id, id);
  }

  @Post('onboard')
  @UseGuards(RolesGuard)
  @Roles(UserRole.DRIVER)
  onboard(@CurrentUser() user: User, @Body() dto: OnboardDriverDto) {
    return this.driversService.onboard(user.id, dto);
  }

  @Get('me')
  @UseGuards(RolesGuard)
  @Roles(UserRole.DRIVER)
  me(@CurrentUser() user: User) {
    return this.driversService.findByUserId(user.id);
  }

  @Patch('availability/:status')
  @UseGuards(RolesGuard)
  @Roles(UserRole.DRIVER)
  setAvailability(
    @CurrentUser() user: User,
    @Param('status') status: DriverAvailability,
  ) {
    return this.driversService.setAvailability(user.id, status);
  }

  @Patch('location')
  @UseGuards(RolesGuard)
  @Roles(UserRole.DRIVER)
  updateLocation(@CurrentUser() user: User, @Body() dto: UpdateLocationDto) {
    return this.driversService.updateLocation(user.id, dto.lat, dto.lng);
  }

  @Patch(':driverId/approval/:status')
  @UseGuards(RolesGuard, PermissionsGuard)
  @Roles(UserRole.ADMIN, UserRole.COUNTRY_ADMIN, UserRole.CITY_MANAGER, UserRole.SUPER_ADMIN)
  @RequirePermission(Permission.DRIVERS_APPROVE)
  @Audit('driver.approval.change')
  setApproval(
    @Param('driverId') driverId: string,
    @Param('status') status: DriverApprovalStatus,
  ) {
    return this.driversService.setApprovalStatus(driverId, status);
  }

  @Get('admin/list')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.COUNTRY_ADMIN, UserRole.CITY_MANAGER, UserRole.SUPPORT_AGENT)
  listForAdmin(@Query('approvalStatus') approvalStatus?: DriverApprovalStatus) {
    return this.driversService.listForAdmin(approvalStatus ? { approvalStatus } : undefined);
  }

  // ---- Documents ----

  @Post('documents')
  @UseGuards(RolesGuard)
  @Roles(UserRole.DRIVER)
  async uploadDocument(@CurrentUser() user: User, @Body() dto: UploadDocumentDto) {
    const profile = await this.driversService.findByUserId(user.id);
    return this.documentsService.upload(profile.id, dto);
  }

  @Get('documents/mine')
  @UseGuards(RolesGuard)
  @Roles(UserRole.DRIVER)
  async myDocuments(@CurrentUser() user: User) {
    const profile = await this.driversService.findByUserId(user.id);
    return this.documentsService.listForDriver(profile.id);
  }

  @Get('admin/documents/pending')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  listPendingDocuments() {
    return this.documentsService.listPendingReview();
  }

  @Patch('admin/documents/:id/approve')
  @UseGuards(RolesGuard, PermissionsGuard)
  @Roles(UserRole.ADMIN, UserRole.COUNTRY_ADMIN, UserRole.CITY_MANAGER, UserRole.SUPER_ADMIN)
  @RequirePermission(Permission.DRIVER_DOCUMENTS_REVIEW)
  @Audit('driver_document.approve')
  approveDocument(@CurrentUser() user: User, @Param('id') id: string) {
    return this.documentsService.approve(id, user.id);
  }

  @Patch('admin/documents/:id/reject')
  @UseGuards(RolesGuard, PermissionsGuard)
  @Roles(UserRole.ADMIN, UserRole.COUNTRY_ADMIN, UserRole.CITY_MANAGER, UserRole.SUPER_ADMIN)
  @RequirePermission(Permission.DRIVER_DOCUMENTS_REVIEW)
  @Audit('driver_document.reject')
  rejectDocument(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: ReviewDocumentDto) {
    return this.documentsService.reject(id, user.id, dto.rejectionReason ?? 'No reason provided');
  }
}
