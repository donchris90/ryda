import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import { GeofenceService } from './geofence.service';
import { CreateGeofenceDto } from './dto/geofence.dto';
import { GeofenceType } from './entities/geofence.entity';
import { Audit } from '../../audit/decorators/audit.decorator';

const ADMIN_ROLES = [UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.COUNTRY_ADMIN, UserRole.CITY_MANAGER];

@Controller()
export class GeofenceController {
  constructor(private readonly geofenceService: GeofenceService) {}

  @Get('geofences/check')
  checkPoint(@Query('lat') lat: string, @Query('lng') lng: string) {
    return this.geofenceService.checkPoint(parseFloat(lat), parseFloat(lng));
  }

  @Get('admin/geofences')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ADMIN_ROLES)
  listAll() {
    return this.geofenceService.listAll();
  }

  @Post('admin/geofences')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ADMIN_ROLES)
  @Audit('geofence.create')
  create(@Body() dto: CreateGeofenceDto) {
    return this.geofenceService.create(dto);
  }

  @Patch('admin/geofences/:id/active/:isActive')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ADMIN_ROLES)
  @Audit('geofence.status_change')
  setActive(@Param('id') id: string, @Param('isActive') isActive: string) {
    return this.geofenceService.setActive(id, isActive === 'true');
  }

  @Get('admin/geofences/events')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ADMIN_ROLES, UserRole.SUPPORT_AGENT)
  recentEvents() {
    return this.geofenceService.listRecentEvents();
  }

  @Get('admin/geofences/events/driver/:driverUserId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ADMIN_ROLES, UserRole.SUPPORT_AGENT)
  driverEvents(@Param('driverUserId') driverUserId: string) {
    return this.geofenceService.listEventsForDriver(driverUserId);
  }
}
