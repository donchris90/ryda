import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { User } from '../users/entities/user.entity';
import { PassengersService } from './passengers.service';
import {
  BlacklistPassengerDto,
  CreateEmergencyContactDto,
  CreateFavouritePlaceDto,
  SetAddressDto,
  SubmitVerificationDto,
  UpdatePreferencesDto,
} from './dto/passengers.dto';
import { KycStatus } from '../common/enums/driver-status.enum';
import { Audit } from '../audit/decorators/audit.decorator';
import { RequirePermission } from '../common/permissions/require-permission.decorator';
import { PermissionsGuard } from '../common/permissions/permissions.guard';
import { Permission } from '../common/permissions/permission.enum';

@Controller('passengers')
@UseGuards(JwtAuthGuard)
export class PassengersController {
  constructor(private readonly passengersService: PassengersService) {}

  @Get('me')
  me(@CurrentUser() user: User) {
    return this.passengersService.getOrCreate(user.id);
  }

  @Patch('me/preferences')
  updatePreferences(@CurrentUser() user: User, @Body() dto: UpdatePreferencesDto) {
    return this.passengersService.updatePreferences(user.id, dto);
  }

  @Post('me/verification')
  submitVerification(@CurrentUser() user: User, @Body() dto: SubmitVerificationDto) {
    return this.passengersService.submitVerification(user.id, dto);
  }

  @Post('me/home')
  setHome(@CurrentUser() user: User, @Body() dto: SetAddressDto) {
    return this.passengersService.setHome(user.id, dto);
  }

  @Post('me/work')
  setWork(@CurrentUser() user: User, @Body() dto: SetAddressDto) {
    return this.passengersService.setWork(user.id, dto);
  }

  @Get('me/favourites')
  listFavourites(@CurrentUser() user: User) {
    return this.passengersService.listFavourites(user.id);
  }

  @Post('me/favourites')
  addFavourite(@CurrentUser() user: User, @Body() dto: CreateFavouritePlaceDto) {
    return this.passengersService.addFavourite(user.id, dto);
  }

  @Delete('me/favourites/:id')
  removeFavourite(@CurrentUser() user: User, @Param('id') id: string) {
    return this.passengersService.removeFavourite(user.id, id);
  }

  @Get('me/emergency-contacts')
  listEmergencyContacts(@CurrentUser() user: User) {
    return this.passengersService.listEmergencyContacts(user.id);
  }

  @Post('me/emergency-contacts')
  addEmergencyContact(@CurrentUser() user: User, @Body() dto: CreateEmergencyContactDto) {
    return this.passengersService.addEmergencyContact(user.id, dto);
  }

  @Delete('me/emergency-contacts/:id')
  removeEmergencyContact(@CurrentUser() user: User, @Param('id') id: string) {
    return this.passengersService.removeEmergencyContact(user.id, id);
  }

  // ---- Admin / trust & safety ----

  @Get(':userId')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPPORT_AGENT, UserRole.SUPER_ADMIN)
  adminView(@Param('userId') userId: string) {
    return this.passengersService.getOrCreate(userId);
  }

  @Patch(':userId/blacklist')
  @UseGuards(RolesGuard, PermissionsGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPPORT_AGENT, UserRole.SUPER_ADMIN)
  @RequirePermission(Permission.PASSENGERS_BLACKLIST)
  @Audit('passenger.blacklist.change')
  setBlacklist(@Param('userId') userId: string, @Body() dto: BlacklistPassengerDto) {
    return this.passengersService.setBlacklist(userId, dto);
  }

  @Patch(':userId/verification/:status')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Audit('passenger.verification.change')
  setVerification(@Param('userId') userId: string, @Param('status') status: KycStatus) {
    return this.passengersService.setVerificationStatus(userId, status);
  }
}
