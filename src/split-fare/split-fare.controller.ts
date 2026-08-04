import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { SplitFareService } from './split-fare.service';
import { CreateSplitFareDto } from './dto/create-split-fare.dto';

@Controller('rides/:rideId/split')
@UseGuards(JwtAuthGuard)
export class SplitFareController {
  constructor(private readonly splitFareService: SplitFareService) {}

  @Post()
  create(@Param('rideId') rideId: string, @CurrentUser() user: User, @Body() dto: CreateSplitFareDto) {
    return this.splitFareService.create(rideId, user.id, dto);
  }

  @Get()
  get(@Param('rideId') rideId: string, @CurrentUser() user: User) {
    return this.splitFareService.getByRide(rideId, user.id);
  }

  @Post('pay')
  pay(@Param('rideId') rideId: string, @CurrentUser() user: User) {
    return this.splitFareService.payShare(rideId, user.id);
  }
}
