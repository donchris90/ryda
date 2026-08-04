import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum FleetPayoutStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  SUCCESS = 'success',
  FAILED = 'failed',
}

@Entity('fleet_payouts')
export class FleetPayout {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  fleetCompanyId: string;

  @Column({ type: 'decimal', precision: 14, scale: 2 })
  amount: string;

  @Column()
  bankAccountNumber: string;

  @Column()
  bankCode: string;

  @Column({ type: 'enum', enum: FleetPayoutStatus, default: FleetPayoutStatus.PENDING })
  status: FleetPayoutStatus;

  @Column({ default: false })
  simulated: boolean;

  @Column({ type: 'varchar', nullable: true })
  paystackTransferCode: string | null;

  @Column({ type: 'varchar', nullable: true })
  failureReason: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
