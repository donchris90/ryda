import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

// Matches Paystack's real dispute status values exactly (Disputes API
// docs) - not an invented simplification, so a status read straight
// off a webhook payload maps onto this enum with no translation layer.
export enum DisputeStatus {
  AWAITING_MERCHANT_FEEDBACK = 'awaiting-merchant-feedback',
  AWAITING_BANK_FEEDBACK = 'awaiting-bank-feedback',
  PENDING = 'pending',
  RESOLVED = 'resolved',
}

// Only meaningful once status is RESOLVED - matches Paystack's own
// resolution values exactly, same reasoning as DisputeStatus above.
export enum DisputeResolution {
  MERCHANT_ACCEPTED = 'merchant-accepted', // the platform accepted the chargeback - money goes back to the customer
  DECLINED = 'declined', // the platform contested and won - no money moves
}

@Entity('payment_disputes')
export class PaymentDispute {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Paystack's own dispute id - what charge.dispute.create/.remind/
  // .resolve all key off, so a webhook replay or the periodic
  // .remind reminder updates the same row rather than creating a
  // duplicate.
  @Index({ unique: true })
  @Column()
  paystackDisputeId: string;

  // The disputed payment's own reference (PaymentRecord.reference) -
  // how this row gets linked back to a ride/delivery/topup and to
  // the user who made the payment.
  @Index()
  @Column()
  paymentReference: string;

  // Denormalized from the linked PaymentRecord at webhook-handling
  // time - null only if that lookup itself failed (the payment
  // record was somehow not found), which should be rare but must
  // never crash the webhook handler over it.
  @Index()
  @Column({ type: 'varchar', nullable: true })
  userId: string | null;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  amount: string;

  @Column({ type: 'enum', enum: DisputeStatus, default: DisputeStatus.AWAITING_MERCHANT_FEEDBACK })
  status: DisputeStatus;

  @Column({ type: 'enum', enum: DisputeResolution, nullable: true })
  resolution: DisputeResolution | null;

  @Column({ type: 'varchar', nullable: true })
  reason: string | null;

  @Column({ type: 'timestamp', nullable: true })
  dueAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
