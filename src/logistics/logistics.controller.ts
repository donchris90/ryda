import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { User } from '../users/entities/user.entity';
import { LogisticsService } from './logistics.service';
import {
  CancelDeliveryDto,
  EstimateDeliveryDto,
  RequestDeliveryDto,
} from './dto/logistics.dto';
import { SelectCourierDto } from './dto/select-courier.dto';
import { RateDeliveryDto } from './dto/rate-delivery.dto';
import { DeliveryCancelledBy } from './entities/delivery-order.entity';
import { RequireFeature } from '../feature-flags/require-feature.decorator';
import { FeatureFlagGuard } from '../feature-flags/feature-flag.guard';
import { FEATURE_KEYS } from '../feature-flags/feature-flags.service';

@Controller('deliveries')
@UseGuards(FeatureFlagGuard)
@RequireFeature(FEATURE_KEYS.LOGISTICS)
export class LogisticsController {
  constructor(private readonly logisticsService: LogisticsService) {}

  // Public — same reasoning as the ride fare estimate: no login needed to see a price.
  @Post('estimate')
  estimate(@Body() dto: EstimateDeliveryDto) {
    return this.logisticsService.estimateFare(dto);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  request(@CurrentUser() user: User, @Body() dto: RequestDeliveryDto) {
    return this.logisticsService.requestDelivery(user.id, dto);
  }

  @Get('mine')
  @UseGuards(JwtAuthGuard)
  mine(@CurrentUser() user: User) {
    return this.logisticsService.findForCustomer(user.id);
  }

  @Get('driver/mine')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.DRIVER)
  driverMine(@CurrentUser() user: User) {
    return this.logisticsService.findForDriver(user.id);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  get(@Param('id') id: string) {
    return this.logisticsService.findById(id);
  }

  // OPTION B ("choose a courier") — passenger-facing candidate list.
  // Only meaningful while the order is still SEARCHING/REQUESTED;
  // returns [] once it's been assigned or moved on, same as rides'
  // selectable-drivers does for an already-matched ride.
  @Get(':id/candidates')
  @UseGuards(JwtAuthGuard)
  candidates(@CurrentUser() user: User, @Param('id') id: string) {
    return this.logisticsService.findSelectableCouriers(id, user.id);
  }

  @Post(':id/select-courier')
  @UseGuards(JwtAuthGuard)
  selectCourier(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: SelectCourierDto,
  ) {
    return this.logisticsService.selectCourier(id, user.id, dto.driverUserId);
  }

  @Post(':id/rate/driver')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.PASSENGER)
  rateDriver(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: RateDeliveryDto,
  ) {
    return this.logisticsService.rateDriver(id, user.id, dto);
  }

  @Patch(':id/accept')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.DRIVER)
  accept(@CurrentUser() user: User, @Param('id') id: string) {
    return this.logisticsService.acceptDelivery(id, user.id);
  }

  @Patch(':id/pickup-arrived')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.DRIVER)
  pickupArrived(@CurrentUser() user: User, @Param('id') id: string) {
    return this.logisticsService.markPickupArrived(id, user.id);
  }

  @Patch(':id/picked-up')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.DRIVER)
  pickedUp(@CurrentUser() user: User, @Param('id') id: string) {
    return this.logisticsService.markPickedUp(id, user.id);
  }

  @Patch(':id/in-transit')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.DRIVER)
  inTransit(@CurrentUser() user: User, @Param('id') id: string) {
    return this.logisticsService.markInTransit(id, user.id);
  }

  @Patch(':id/delivered')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.DRIVER)
  delivered(@CurrentUser() user: User, @Param('id') id: string) {
    return this.logisticsService.markDelivered(id, user.id);
  }

  @Patch(':id/cancel')
  @UseGuards(JwtAuthGuard)
  cancel(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: CancelDeliveryDto,
  ) {
    const cancelledBy =
      user.role === UserRole.DRIVER
        ? DeliveryCancelledBy.DRIVER
        : DeliveryCancelledBy.CUSTOMER;
    return this.logisticsService.cancelDelivery(id, user.id, cancelledBy, dto);
  }
}
