import { Body, Controller, Get, Param, Post, Patch, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { User } from '../users/entities/user.entity';
import { AirportService } from './airport.service';
import {
  CreateAirportDto,
  UpdateAirportDto,
  CreateAirportZoneDto,
  UpdateAirportZoneDto,
} from './dto/airport.dto';
import { Audit } from '../audit/decorators/audit.decorator';
import { RequireFeature } from '../feature-flags/require-feature.decorator';
import { FeatureFlagGuard } from '../feature-flags/feature-flag.guard';
import { FEATURE_KEYS } from '../feature-flags/feature-flags.service';

const ADMIN_ROLES = [UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.COUNTRY_ADMIN];

@Controller('airports')
@UseGuards(FeatureFlagGuard)
@RequireFeature(FEATURE_KEYS.AIRPORT_MODULE)
export class AirportController {
  constructor(private readonly airportService: AirportService) {}

  @Get()
  list() {
    return this.airportService.listActive();
  }

  // Admin-only: includes inactive airports, unlike GET /airports above.
  @Get('admin/all')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ADMIN_ROLES)
  listAll() {
    return this.airportService.listAll();
  }

  @Get('detect')
  detect(@Query('lat') lat: string, @Query('lng') lng: string) {
    return this.airportService.findContainingAirport(parseFloat(lat), parseFloat(lng));
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ADMIN_ROLES)
  @Audit('airport.create')
  create(@Body() dto: CreateAirportDto) {
    return this.airportService.create(dto);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ADMIN_ROLES)
  @Audit('airport.update')
  update(@Param('id') id: string, @Body() dto: UpdateAirportDto) {
    return this.airportService.update(id, dto);
  }

  // ---- Named pickup zones ----

  @Get(':id/zones')
  listZones(@Param('id') airportId: string) {
    return this.airportService.listZones(airportId);
  }

  @Get(':id/zones/admin')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ADMIN_ROLES)
  listZonesForAdmin(@Param('id') airportId: string) {
    return this.airportService.listZones(airportId, true);
  }

  @Get(':id/zones/detect')
  detectZone(
    @Param('id') airportId: string,
    @Query('lat') lat: string,
    @Query('lng') lng: string,
  ) {
    return this.airportService.findContainingZone(airportId, parseFloat(lat), parseFloat(lng));
  }

  @Post(':id/zones')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ADMIN_ROLES)
  @Audit('airport.zone.create')
  createZone(@Param('id') airportId: string, @Body() dto: CreateAirportZoneDto) {
    return this.airportService.createZone(airportId, dto);
  }

  @Patch('zones/:zoneId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ADMIN_ROLES)
  @Audit('airport.zone.update')
  updateZone(@Param('zoneId') zoneId: string, @Body() dto: UpdateAirportZoneDto) {
    return this.airportService.updateZone(zoneId, dto);
  }

  // ---- Driver pickup queue ----

  @Post(':id/queue/join')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.DRIVER)
  joinQueue(@CurrentUser() user: User, @Param('id') airportId: string) {
    return this.airportService.joinQueue(airportId, user.id);
  }

  @Post(':id/queue/leave')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.DRIVER)
  leaveQueue(@CurrentUser() user: User, @Param('id') airportId: string) {
    return this.airportService.leaveQueue(airportId, user.id);
  }

  @Get(':id/queue')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.DISPATCHER)
  listQueue(@Param('id') airportId: string) {
    return this.airportService.listQueue(airportId);
  }

  @Get(':id/queue/mine')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.DRIVER)
  myPosition(@CurrentUser() user: User, @Param('id') airportId: string) {
    return this.airportService.myQueuePosition(airportId, user.id);
  }
}
