import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { VehicleStatus } from '../common/enums/vehicle.enum';
import { User } from '../users/entities/user.entity';
import { VehiclesService } from './vehicles.service';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { SetApprovedRideCategoriesDto } from './dto/set-approved-ride-categories.dto';
import { DriversService } from '../drivers/drivers.service';
import { StorageService } from '../storage/storage.service';

@Controller('vehicles')
@UseGuards(JwtAuthGuard, RolesGuard)
export class VehiclesController {
  constructor(
    private readonly vehiclesService: VehiclesService,
    private readonly driversService: DriversService,
    private readonly storageService: StorageService,
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

  // A driver photographing their own registered car, shown to
  // passengers on the MANUAL "choose your driver" screen alongside the
  // driver's own profile photo (see RidesService.findSelectableDrivers()).
  // Ownership is checked explicitly here, not just RolesGuard - a
  // DRIVER role alone doesn't prove this is *their* vehicle.
  @Post(':id/photo')
  @Roles(UserRole.DRIVER)
  @UseInterceptors(FileInterceptor('file'))
  async uploadPhoto(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const vehicle = await this.vehiclesService.findById(id);
    if (vehicle.driverId !== user.id) {
      throw new ForbiddenException('This is not your vehicle');
    }
    const { url } = await this.storageService.upload(
      { buffer: file.buffer, originalname: file.originalname, mimetype: file.mimetype },
      'vehicle-photos',
    );
    return this.vehiclesService.setPhoto(id, url);
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

  // Lets an admin manually approve a specific vehicle for ride
  // categories beyond its strict default mapping - e.g. a genuinely
  // nice registered-as-"car" vehicle covering Comfort, XL, or Luxury.
  // See ride-vehicle-match.util.ts for why this exists as a per-vehicle
  // human judgment call rather than a rigid enum expansion.
  @Patch('admin/:id/approved-ride-categories')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.COUNTRY_ADMIN)
  setApprovedRideCategories(@Param('id') id: string, @Body() dto: SetApprovedRideCategoriesDto) {
    return this.vehiclesService.setApprovedRideCategories(id, dto.categories);
  }
}
