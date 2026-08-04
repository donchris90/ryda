import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaymentRecord } from './entities/payment-record.entity';
import { SavedCard } from './entities/saved-card.entity';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { PaystackService } from './paystack/paystack.service';
import { WalletsModule } from '../wallets/wallets.module';

@Module({
  imports: [TypeOrmModule.forFeature([PaymentRecord, SavedCard]), forwardRef(() => WalletsModule)],
  providers: [PaymentsService, PaystackService],
  controllers: [PaymentsController],
  exports: [PaymentsService, PaystackService],
})
export class PaymentsModule {}
