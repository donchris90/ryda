import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaymentRecord } from './entities/payment-record.entity';
import { SavedCard } from './entities/saved-card.entity';
import { PaymentDispute } from './entities/payment-dispute.entity';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { PaystackService } from './paystack/paystack.service';
import { PaystackReconciliationService } from './paystack-reconciliation.service';
import { WalletsModule } from '../wallets/wallets.module';
import { FraudModule } from '../fraud/fraud.module';

@Module({
  imports: [TypeOrmModule.forFeature([PaymentRecord, SavedCard, PaymentDispute]), forwardRef(() => WalletsModule), FraudModule],
  providers: [PaymentsService, PaystackService, PaystackReconciliationService],
  controllers: [PaymentsController],
  exports: [PaymentsService, PaystackService, PaystackReconciliationService],
})
export class PaymentsModule {}
