import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { User } from '../users/entities/user.entity';
import { AirportService } from './airport.service';
import { CreateAirportDto } from './dto/airport.dto';
import { Audit } from '../audit/decorators/audit.decorator';
import { RequireFeature } from '../feature-flags/require-feature.decorator';
import { FeatureFlagGuard } from '../feature-flags/feature-flag.guard';
import { FEATURE_KEYS } from '../feature-flags/feature-flags.service';

@Controller('airports')
@UseGuards(FeatureFlagGuard)
@RequireFeature(FEATURE_KEYS.AIRPORT_MODULE)
export class AirportController {
  constructor(private readonly airportService: AirportService) {}

  @Get()
  list() {
    return this.airportService.listActive();
  }

  @Get('detect')
  detect(@Query('lat') lat: string, @Query('lng') lng: string) {
    return this.airportService.findContainingAirport(parseFloat(lat), parseFloat(lng));
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.COUNTRY_ADMIN)
  @Audit('airport.create')
  create(@Body() dto: CreateAirportDto) {
    return this.airportService.create(dto);
  }

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
