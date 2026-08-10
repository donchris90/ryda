import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Wallet } from './entities/wallet.entity';
import { WalletTransaction } from './entities/wallet-transaction.entity';
import { BankAccount } from './entities/bank-account.entity';
import { WithdrawalRequest } from './entities/withdrawal-request.entity';
import { WalletTransferRequest } from './entities/wallet-transfer-request.entity';
import { WalletsService } from './wallets.service';
import { WalletTransfersService } from './wallet-transfers.service';
import { WalletsController } from './wallets.controller';
import { WithdrawalsService } from './withdrawals.service';
import { WithdrawalsController } from './withdrawals.controller';
import { SettingsModule } from '../settings/settings.module';
import { ObservabilityModule } from '../observability/observability.module';
import { PaymentsModule } from '../payments/payments.module';
import { UsersModule } from '../users/users.module';
import { OtpModule } from '../otp/otp.module';
import { MailerModule } from '../mailer/mailer.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Wallet, WalletTransaction, BankAccount, WithdrawalRequest, WalletTransferRequest]),
    SettingsModule,
    ObservabilityModule,
    forwardRef(() => PaymentsModule),
    UsersModule,
    OtpModule,
    MailerModule,
  ],
  providers: [WalletsService, WalletTransfersService, WithdrawalsService],
  controllers: [WalletsController, WithdrawalsController],
  exports: [WalletsService, WalletTransfersService, WithdrawalsService],
})
export class WalletsModule {}
