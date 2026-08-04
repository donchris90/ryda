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
}

export enum FraudFlagSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
}

export enum FraudFlagStatus {
  OPEN = 'open',
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
