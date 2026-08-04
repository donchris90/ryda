import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { TransactionDirection } from '../../common/enums/transaction.enum';

export enum FleetTransactionCategory {
  RIDE_EARNING = 'ride_earning', // a fleet driver's earnings landed here instead of a personal wallet
  PAYOUT = 'payout', // withdrawn out to the fleet owner's bank account
  ADJUSTMENT = 'adjustment', // manual admin correction
}

@Entity('fleet_transactions')
export class FleetTransaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  fleetWalletId: string;

  @Column({ type: 'enum', enum: TransactionDirection })
  direction: TransactionDirection;

  @Column({ type: 'enum', enum: FleetTransactionCategory })
  category: FleetTransactionCategory;

  @Column({ type: 'decimal', precision: 14, scale: 2 })
  amount: string;

  @Column({ type: 'decimal', precision: 14, scale: 2 })
  balanceAfter: string;

  @Column({ type: 'varchar', nullable: true })
  referenceId: string | null;

  @Column({ type: 'varchar', nullable: true })
  description: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
