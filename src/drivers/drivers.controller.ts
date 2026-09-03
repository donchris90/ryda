import { Body, Controller, Delete, Get, InternalServerErrorException, ParseEnumPipe, Param, Patch, Post, Query, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
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
import { ReviewServiceCapabilityDto } from './dto/review-service-capability.dto';
import { DriverAvailability, DriverApprovalStatus } from '../common/enums/driver-status.enum';
import { DriverService, ServiceApprovalStatus } from '../common/enums/driver-service.enum';
import { Audit } from '../audit/decorators/audit.decorator';
import { RequirePermission } from '../common/permissions/require-permission.decorator';
import { PermissionsGuard } from '../common/permissions/permissions.guard';
import { Permission } from '../common/permissions/permission.enum';
import { PassengersService } from '../passengers/passengers.service';
import { CreateEmergencyContactDto } from '../passengers/dto/passengers.dto';
import { StorageService } from '../storage/storage.service';

@Controller('drivers')
@UseGuards(JwtAuthGuard)
export class DriversController {
  constructor(
    private readonly driversService: DriversService,
    private readonly documentsService: DriverDocumentsService,
    private readonly passengersService: PassengersService,
    private readonly storageService: StorageService,
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

  /**
   * The driver's own requested/approved service capabilities — backs
   * the "Your services" dashboard section and the go-online screen's
   * decision about whether to ask "What are you available for?" at
   * all (only asked when more than one service is APPROVED).
   */
  @Get('me/services')
  @UseGuards(RolesGuard)
  @Roles(UserRole.DRIVER)
  async myServices(@CurrentUser() user: User) {
    const profile = await this.driversService.findByUserId(user.id);
    return this.driversService.listServiceCapabilities(profile.id);
  }

  @Patch('availability/:status')
  @UseGuards(RolesGuard)
  @Roles(UserRole.DRIVER)
  setAvailability(
    @CurrentUser() user: User,
    @Param('status', new ParseEnumPipe(DriverAvailability)) status: DriverAvailability,
  ) {
    return this.driversService.setAvailability(user.id, status);
  }

  @Patch('location')
  @UseGuards(RolesGuard)
  @Roles(UserRole.DRIVER)
  updateLocation(@CurrentUser() user: User, @Body() dto: UpdateLocationDto) {
    return this.driversService.updateLocation(user.id, dto.lat, dto.lng, dto.accuracy, dto.fixTimestamp);
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

  /**
   * Per-service approval — distinct from the overall
   * PATCH :driverId/approval/:status above. A driver requesting RIDE +
   * DELIVERY at registration does NOT auto-approve either one; this is
   * the only endpoint that can move a capability to APPROVED, and it's
   * gated by the same DRIVERS_APPROVE permission and document checks
   * as overall approval (see DriversService.decideServiceCapability()).
   */
  @Patch(':driverId/services/:service/:status')
  @UseGuards(RolesGuard, PermissionsGuard)
  @Roles(UserRole.ADMIN, UserRole.COUNTRY_ADMIN, UserRole.CITY_MANAGER, UserRole.SUPER_ADMIN)
  @RequirePermission(Permission.DRIVERS_APPROVE)
  @Audit('driver.service_capability.change')
  decideServiceCapability(
    @CurrentUser() user: User,
    @Param('driverId') driverId: string,
    @Param('service') service: DriverService,
    @Param('status') status: ServiceApprovalStatus.APPROVED | ServiceApprovalStatus.REJECTED,
    @Body() dto: ReviewServiceCapabilityDto,
  ) {
    return this.driversService.decideServiceCapability(
      driverId,
      service,
      status,
      user.id,
      dto.rejectionReason,
    );
  }

  @Get('admin/list')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.COUNTRY_ADMIN, UserRole.CITY_MANAGER, UserRole.SUPPORT_AGENT)
  listForAdmin(@Query('approvalStatus') approvalStatus?: DriverApprovalStatus) {
    return this.driversService.listForAdmin(approvalStatus ? { approvalStatus } : undefined);
  }

  // ---- Documents ----

  /**
   * UploadDocumentDto expects a documentUrl string, not a file directly
   * — there was no endpoint that actually produced one for driver
   * documents (the pattern already exists for profile photos, on
   * UsersController, just never had a driver-documents equivalent).
   * Two-step flow: upload the file here to get a URL, then submit that
   * URL via POST /drivers/documents with the document type.
   */
  @Post('documents/upload-file')
  @UseGuards(RolesGuard)
  @Roles(UserRole.DRIVER)
  @UseInterceptors(FileInterceptor('file'))
  async uploadDocumentFile(@UploadedFile() file: Express.Multer.File) {
    try {
      const { url } = await this.storageService.upload(
        { buffer: file.buffer, originalname: file.originalname, mimetype: file.mimetype },
        'driver-documents',
      );
      return { url };
    } catch (err) {
      // Without this, any storage failure (wrong bucket, bad
      // permissions, misconfigured account ID) surfaces as a bare
      // "Internal server error" with no way to tell what's actually
      // wrong short of digging through server logs. Surfacing the
      // real reason here is what makes this diagnosable at all from
      // the client side.
      const reason = err instanceof Error ? err.message : 'Unknown storage error';
      throw new InternalServerErrorException(`Could not upload file: ${reason}`);
    }
  }

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
