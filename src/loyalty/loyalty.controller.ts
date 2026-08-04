import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { LoyaltyService } from './loyalty.service';
import { RedeemLoyaltyDto } from './dto/redeem-loyalty.dto';

@Controller('loyalty')
@UseGuards(JwtAuthGuard)
export class LoyaltyController {
  constructor(private readonly loyaltyService: LoyaltyService) {}

  @Get('me')
  getAccount(@CurrentUser() user: User) {
    return this.loyaltyService.getAccount(user.id);
  }

  @Get('me/transactions')
  getTransactions(@CurrentUser() user: User) {
    return this.loyaltyService.getTransactions(user.id);
  }

  @Post('me/redeem')
  redeem(@CurrentUser() user: User, @Body() dto: RedeemLoyaltyDto) {
    return this.loyaltyService.redeem(user.id, dto.points);
  }
}
