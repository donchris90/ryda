import { Body, Controller, forwardRef, Get, Inject, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { WalletsService } from './wallets.service';
import { WalletTransfersService } from './wallet-transfers.service';
import { TopUpDto } from './dto/topup.dto';
import { InitiateTransferDto, ConfirmTransferDto } from './dto/transfer.dto';
import { PaymentsService } from '../payments/payments.service';
import { BadRequestException } from '@nestjs/common';

@Controller('wallet')
@UseGuards(JwtAuthGuard)
export class WalletsController {
  constructor(
    private readonly walletsService: WalletsService,
    private readonly walletTransfersService: WalletTransfersService,
    @Inject(forwardRef(() => PaymentsService))
    private readonly paymentsService: PaymentsService,
  ) {}

  @Get()
  async getWallet(@CurrentUser() user: User) {
    return this.walletsService.getByUserId(user.id);
  }

  // Fairly tight limit - this is the entry point to moving real money,
  // matching the same caution the existing OTP-send endpoint already
  // applies in auth.controller.ts.
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('transfer/initiate')
  async initiateTransfer(@CurrentUser() user: User, @Body() dto: InitiateTransferDto) {
    return this.walletTransfersService.initiate(user.id, dto);
  }

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('transfer/confirm')
  async confirmTransfer(@CurrentUser() user: User, @Body() dto: ConfirmTransferDto) {
    return this.walletTransfersService.confirm(user.id, dto);
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
