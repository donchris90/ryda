import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { DeliveryVehicleTypesService } from './delivery-vehicle-types.service';
import { DeliveryVehicleType } from './entities/delivery-order.entity';
import { UpsertVehicleTypeConfigDto } from './dto/vehicle-type-config.dto';

// Genuinely public - a passenger picking a delivery vehicle type needs
// to see prices and capacity before logging in, same reasoning as the
// ride fare estimate endpoint.
@Controller('delivery-vehicle-types')
export class DeliveryVehicleTypesController {
  constructor(private readonly vehicleTypesService: DeliveryVehicleTypesService) {}

  @Get()
  listActive() {
    return this.vehicleTypesService.listActive();
  }
}

@Controller('admin/delivery-vehicle-types')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.COUNTRY_ADMIN)
export class AdminDeliveryVehicleTypesController {
  constructor(private readonly vehicleTypesService: DeliveryVehicleTypesService) {}

  @Get()
  listAll() {
    return this.vehicleTypesService.listAll();
  }

  @Put(':vehicleType')
  upsert(@Param('vehicleType') vehicleType: DeliveryVehicleType, @Body() dto: UpsertVehicleTypeConfigDto) {
    return this.vehicleTypesService.upsert(vehicleType, dto);
  }
}
