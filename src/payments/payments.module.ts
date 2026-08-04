import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaymentRecord } from './entities/payment-record.entity';
import { SavedCard } from './entities/saved-card.entity';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { PaystackService } from './paystack/paystack.service';

@Module({
  imports: [TypeOrmModule.forFeature([PaymentRecord, SavedCard])],
  providers: [PaymentsService, PaystackService],
  controllers: [PaymentsController],
  exports: [PaymentsService, PaystackService],
})
export class PaymentsModule {}
