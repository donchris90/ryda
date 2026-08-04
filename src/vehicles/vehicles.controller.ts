import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { VehicleStatus } from '../common/enums/vehicle.enum';
import { User } from '../users/entities/user.entity';
import { VehiclesService } from './vehicles.service';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { DriversService } from '../drivers/drivers.service';

@Controller('vehicles')
@UseGuards(JwtAuthGuard, RolesGuard)
export class VehiclesController {
  constructor(
    private readonly vehiclesService: VehiclesService,
    private readonly driversService: DriversService,
  ) {}

  @Post()
  @Roles(UserRole.DRIVER)
  async register(@CurrentUser() user: User, @Body() dto: CreateVehicleDto) {
    const vehicle = await this.vehiclesService.registerForDriver(user.id, dto);
    // First vehicle registered becomes the driver's active vehicle automatically.
    await this.driversService.setActiveVehicle(user.id, vehicle.id);
    return vehicle;
  }

  @Get('mine')
  @Roles(UserRole.DRIVER)
  mine(@CurrentUser() user: User) {
    return this.vehiclesService.findByDriver(user.id);
  }

  @Get('admin/list')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.COUNTRY_ADMIN, UserRole.CITY_MANAGER, UserRole.SUPPORT_AGENT)
  listForAdmin(
    @Query('status') status?: VehicleStatus,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.vehiclesService.listForAdmin(
      { status },
      page ? parseInt(page, 10) : undefined,
      limit ? parseInt(limit, 10) : undefined,
    );
  }

  @Patch('admin/:id/status/:status')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.COUNTRY_ADMIN, UserRole.CITY_MANAGER)
  setStatus(@Param('id') id: string, @Param('status') status: VehicleStatus) {
    return this.vehiclesService.setStatus(id, status);
  }
}
