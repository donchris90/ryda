import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum ReconciliationStatus {
  PENDING = 'pending',
  SETTLED = 'settled',
  WRITTEN_OFF = 'written_off',
}

export enum ReconciliationSourceType {
  RIDE = 'ride',
  DELIVERY = 'delivery',
}

/**
 * Created when a cash (or COD) trip's commission can't be debited
 * immediately because the driver's (or fleet's) wallet balance is too low
 * — instead of blocking ride/delivery completion, the debt is recorded
 * here and settled later, automatically, the next time that wallet is
 * credited (see ReconciliationService + the wallet.updated listener).
 */
@Entity('cash_reconciliations')
export class CashReconciliation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'varchar', nullable: true })
  driverId: string | null;

  @Index()
  @Column({ type: 'varchar', nullable: true })
  fleetCompanyId: string | null;

  // Despite the name, this holds a DeliveryOrder id when sourceType is
  // DELIVERY, not always a Ride id - kept as-is (rather than renamed)
  // to avoid a breaking column rename against existing rows; sourceType
  // is what actually tells a reader (or the frontend) which it is.
  @Column()
  rideId: string;

  @Index()
  @Column({ type: 'enum', enum: ReconciliationSourceType, default: ReconciliationSourceType.RIDE })
  sourceType: ReconciliationSourceType;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  amountOwed: string;

  @Index()
  @Column({ type: 'enum', enum: ReconciliationStatus, default: ReconciliationStatus.PENDING })
  status: ReconciliationStatus;

  @Column({ type: 'varchar', nullable: true })
  writtenOffBy: string | null;

  @Column({ type: 'varchar', nullable: true })
  writeOffReason: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  settledAt: Date | null;
}
