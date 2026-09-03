import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { CashReconciliation } from './entities/cash-reconciliation.entity';
import { LedgerDiscrepancy } from './entities/ledger-discrepancy.entity';
import { ReconciliationService } from './reconciliation.service';
import { LedgerAuditService } from './ledger-audit.service';
import { ReconciliationController } from './reconciliation.controller';
import { ReconciliationSettlementProcessor } from './processors/reconciliation-settlement.processor';
import { WalletsModule } from '../wallets/wallets.module';
import { FleetModule } from '../fleet/fleet.module';
import { Wallet } from '../wallets/entities/wallet.entity';
import { WalletTransaction } from '../wallets/entities/wallet-transaction.entity';
import { FleetWallet } from '../fleet/entities/fleet-wallet.entity';
import { FleetTransaction } from '../fleet/entities/fleet-transaction.entity';
import { CorporateAccount } from '../corporate/entities/corporate-account.entity';
import { CorporateTransaction } from '../corporate/entities/corporate-transaction.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CashReconciliation,
      LedgerDiscrepancy,
      Wallet,
      WalletTransaction,
      FleetWallet,
      FleetTransaction,
      CorporateAccount,
      CorporateTransaction,
    ]),
    WalletsModule,
    FleetModule,
    BullModule.registerQueue({ name: 'reconciliation-settlement' }),
  ],
  providers: [ReconciliationService, LedgerAuditService, ReconciliationSettlementProcessor],
  controllers: [ReconciliationController],
  exports: [ReconciliationService, LedgerAuditService],
})
export class ReconciliationModule {}
