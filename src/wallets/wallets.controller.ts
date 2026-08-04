import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { WalletsService } from './wallets.service';
import { TopUpDto } from './dto/topup.dto';
import { TransactionCategory } from '../common/enums/transaction.enum';

@Controller('wallet')
@UseGuards(JwtAuthGuard)
export class WalletsController {
  constructor(private readonly walletsService: WalletsService) {}

  @Get()
  async getWallet(@CurrentUser() user: User) {
    return this.walletsService.getByUserId(user.id);
  }

  @Get('transactions')
  async getTransactions(
    @CurrentUser() user: User,
    @Query('limit') limit?: string,
  ) {
    return this.walletsService.getTransactions(
      user.id,
      limit ? parseInt(limit, 10) : undefined,
    );
  }

  /**
   * NOTE: this credits the wallet directly rather than routing through a
   * real payment charge (card/bank transfer) first — wiring that in is a
   * known gap (see README). What IS real here is the configurable max
   * wallet balance enforcement below.
   */
  @Post('topup')
  async topUp(@CurrentUser() user: User, @Body() dto: TopUpDto) {
    const wallet = await this.walletsService.getByUserId(user.id);
    return this.walletsService.credit(
      wallet.id,
      dto.amount,
      TransactionCategory.TOPUP,
      undefined,
      'Wallet top-up',
    );
  }
}
