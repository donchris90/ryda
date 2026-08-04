import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Wallet } from './entities/wallet.entity';
import { WalletTransaction } from './entities/wallet-transaction.entity';
import { BankAccount } from './entities/bank-account.entity';
import { WithdrawalRequest } from './entities/withdrawal-request.entity';
import { WalletsService } from './wallets.service';
import { WalletsController } from './wallets.controller';
import { WithdrawalsService } from './withdrawals.service';
import { WithdrawalsController } from './withdrawals.controller';
import { SettingsModule } from '../settings/settings.module';
import { ObservabilityModule } from '../observability/observability.module';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Wallet, WalletTransaction, BankAccount, WithdrawalRequest]),
    SettingsModule,
    ObservabilityModule,
    forwardRef(() => PaymentsModule),
  ],
  providers: [WalletsService, WithdrawalsService],
  controllers: [WalletsController, WithdrawalsController],
  exports: [WalletsService, WithdrawalsService],
})
export class WalletsModule {}
