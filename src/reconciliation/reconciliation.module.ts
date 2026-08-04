import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { CashReconciliation } from './entities/cash-reconciliation.entity';
import { ReconciliationService } from './reconciliation.service';
import { ReconciliationController } from './reconciliation.controller';
import { ReconciliationSettlementProcessor } from './processors/reconciliation-settlement.processor';
import { WalletsModule } from '../wallets/wallets.module';
import { FleetModule } from '../fleet/fleet.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([CashReconciliation]),
    WalletsModule,
    FleetModule,
    BullModule.registerQueue({ name: 'reconciliation-settlement' }),
  ],
  providers: [ReconciliationService, ReconciliationSettlementProcessor],
  controllers: [ReconciliationController],
  exports: [ReconciliationService],
})
export class ReconciliationModule {}
