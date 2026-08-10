import { Body, Controller, forwardRef, Get, Inject, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { WalletsService } from './wallets.service';
import { TopUpDto } from './dto/topup.dto';
import { PaymentsService } from '../payments/payments.service';
import { BadRequestException } from '@nestjs/common';

@Controller('wallet')
@UseGuards(JwtAuthGuard)
export class WalletsController {
  constructor(
    private readonly walletsService: WalletsService,
    @Inject(forwardRef(() => PaymentsService))
    private readonly paymentsService: PaymentsService,
  ) {}

  @Get()
  async getWallet(@CurrentUser() user: User) {
    return this.walletsService.getByUserId(user.id);
  }

  @Get('transactions')
  async getTransactions(
    @CurrentUser() user: User,
    @Query('limit') limit?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.walletsService.getTransactions(
      user.id,
      limit ? parseInt(limit, 10) : undefined,
      from ? new Date(from) : undefined,
      to ? new Date(to) : undefined,
    );
  }

  @Get('transactions/:id')
  async getTransaction(@CurrentUser() user: User, @Param('id') id: string) {
    return this.walletsService.getTransactionById(user.id, id);
  }

  /**
   * Real Paystack hosted checkout — replaces a previous endpoint that
   * credited the wallet directly from a client-supplied amount with no
   * payment verification at all. See PaymentsService.initWalletTopUp()
   * for the full reasoning. The wallet is never credited here; only the
   * webhook, once Paystack actually confirms the charge, does that.
   */
  @Post('topup/init')
  async initTopUp(@CurrentUser() user: User, @Body() dto: TopUpDto) {
    if (!user.email) {
      throw new BadRequestException('Add an email to your account before topping up your wallet');
    }
    return this.paymentsService.initWalletTopUp(user.id, user.email, dto.amount);
  }
}
