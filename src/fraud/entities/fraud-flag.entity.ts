import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum FraudFlagType {
  DUPLICATE_ACCOUNT = 'duplicate_account', // same device fingerprint across multiple accounts
  GPS_SPOOF = 'gps_spoof', // implied travel speed physically impossible
  REFERRAL_ABUSE = 'referral_abuse', // referrer and referee share a device
  MULTIPLE_ACCOUNTS_SAME_DEVICE = 'multiple_accounts_same_device',
  NEW_DEVICE_LOGIN = 'new_device_login', // login from a device fingerprint never seen before for this account
  HIGH_RISK_WITHDRAWAL_ATTEMPT = 'high_risk_withdrawal_attempt', // withdrawal allowed to proceed, but the requester's risk band was HIGH
  CRITICAL_RISK_WITHDRAWAL_BLOCKED = 'critical_risk_withdrawal_blocked', // withdrawal itself refused - risk band was CRITICAL
  REPEATED_PAYMENT_FAILURES = 'repeated_payment_failures', // several card charges failed in a short window - possible card testing
  MULTIPLE_CARDS_ADDED = 'multiple_cards_added', // several distinct cards added to one account in a short window
  REPEATED_PROMO_REDEMPTION = 'repeated_promo_redemption', // several promo codes redeemed by one user in a short window
  REPEATED_CANCELLATIONS = 'repeated_cancellations', // several rides cancelled by the same passenger in a short window
  EXCESSIVE_REFUNDS = 'excessive_refunds', // several refunds issued to the same user in a short window
  UNUSUAL_WALLET_VELOCITY = 'unusual_wallet_velocity', // several wallet-to-wallet transfers sent by the same user in a short window
  CHARGEBACK_HISTORY = 'chargeback_history', // one or more chargebacks resolved against this user
}

export enum FraudFlagSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

export enum FraudFlagStatus {
  OPEN = 'open',
  ESCALATED = 'escalated',
  REVIEWED = 'reviewed',
  DISMISSED = 'dismissed',
}

@Entity('fraud_flags')
export class FraudFlag {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'enum', enum: FraudFlagType })
  type: FraudFlagType;

  @Index()
  @Column()
  userId: string;

  @Column({ type: 'varchar', nullable: true })
  relatedUserId: string | null;

  @Column({ type: 'enum', enum: FraudFlagSeverity, default: FraudFlagSeverity.MEDIUM })
  severity: FraudFlagSeverity;

  @Column({ type: 'jsonb', nullable: true })
  details: Record<string, unknown> | null;

  @Index()
  @Column({ type: 'enum', enum: FraudFlagStatus, default: FraudFlagStatus.OPEN })
  status: FraudFlagStatus;

  @Column({ type: 'varchar', nullable: true })
  reviewedBy: string | null;

  @Column({ type: 'varchar', nullable: true })
  reviewNotes: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
