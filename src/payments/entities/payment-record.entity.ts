import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { PaymentMethod } from '../../common/enums/ride.enum';

export enum PaymentStatus {
  PENDING = 'pending',
  SUCCESS = 'success',
  FAILED = 'failed',
  REFUNDED = 'refunded',
  PARTIALLY_REFUNDED = 'partially_refunded',
}

@Entity('payment_records')
export class PaymentRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'varchar', nullable: true })
  rideId: string | null;

  @Index()
  @Column()
  userId: string;

  @Column({ type: 'enum', enum: PaymentMethod })
  method: PaymentMethod;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  amount: string;

  @Column({ type: 'enum', enum: PaymentStatus, default: PaymentStatus.PENDING })
  status: PaymentStatus;

  // Our own reference we hand to Paystack — always unique, generated at
  // charge/initialize time, used to look the record up again on webhook.
  @Index({ unique: true })
  @Column({ unique: true })
  reference: string;

  // Simulated charges (no PAYSTACK_SECRET_KEY configured) are clearly
  // flagged so nobody mistakes a dev-mode "success" for a real settlement.
  @Column({ default: false })
  simulated: boolean;

  @Column({ type: 'varchar', nullable: true })
  gatewayReference: string | null;

  @Column({ type: 'varchar', nullable: true })
  failureReason: string | null;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  refundedAmount: string | null;

  // Reserved the moment a refund is requested (before Paystack is even
  // called) and cleared once the refund.processed/refund.failed webhook
  // confirms the outcome. Real Paystack refunds are usually asynchronous
  // — this is what lets refundPayment() reject a second refund attempt
  // while one is still in flight, instead of trusting `refundedAmount`
  // alone, which wouldn't be updated yet.
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  pendingRefundAmount: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}