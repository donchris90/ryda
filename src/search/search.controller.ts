import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { SearchService } from './search.service';

@ApiTags('search')
@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get('airports')
  searchAirports(@Query('q') q: string) {
    return this.searchService.searchAirports(q);
  }

  @Get('vehicles')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.DISPATCHER, UserRole.SUPPORT_AGENT)
  searchVehicles(@Query('q') q: string) {
    return this.searchService.searchVehicles(q);
  }

  @Get('drivers')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.DISPATCHER, UserRole.SUPPORT_AGENT)
  searchDrivers(@Query('q') q: string) {
    return this.searchService.searchDrivers(q);
  }

  @Get('support-tickets')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.SUPPORT_AGENT)
  searchSupportTickets(@Query('q') q: string) {
    return this.searchService.searchSupportTickets(q);
  }

  @Get('passengers')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.DISPATCHER, UserRole.SUPPORT_AGENT)
  searchPassengers(@Query('q') q: string) {
    return this.searchService.searchPassengers(q);
  }

  @Get('corporate-accounts')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.FINANCE)
  searchCorporateAccounts(@Query('q') q: string) {
    return this.searchService.searchCorporateAccounts(q);
  }
}
