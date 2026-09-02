import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum WithdrawalStatus {
  PENDING = 'pending', // requested, OTP not yet confirmed - the actual debit/Paystack transfer has NOT happened yet at this point
  PROCESSING = 'processing', // OTP confirmed, transfer initiated, waiting on Paystack's webhook
  COMPLETED = 'completed', // transfer.success
  FAILED = 'failed', // transfer.failed or transfer.reversed — wallet already refunded by the time this is set
  EXPIRED = 'expired', // OTP window closed before confirmation - no money ever moved
}

@Entity('withdrawal_requests')
export class WithdrawalRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  userId: string;

  @Column()
  bankAccountId: string;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  amount: string;

  @Column({ type: 'enum', enum: WithdrawalStatus, default: WithdrawalStatus.PENDING })
  status: WithdrawalStatus;

  // Paystack's own reference for this transfer — used to match an
  // incoming transfer.success/transfer.failed webhook back to this
  // request, the same pattern PaymentRecord already uses for charges.
  @Index({ unique: true })
  @Column({ unique: true })
  reference: string;

  @Column({ type: 'varchar', nullable: true })
  paystackTransferCode: string | null;

  @Column({ type: 'varchar', nullable: true })
  failureReason: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  completedAt: Date | null;

  // Only meaningful while status is PENDING - the deadline for OTP
  // confirmation before this request expires with no money ever moved.
  @Column({ type: 'timestamp', nullable: true })
  expiresAt: Date | null;
}
