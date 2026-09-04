import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { TransactionDirection } from '../../common/enums/transaction.enum';

@Entity('corporate_transactions')
export class CorporateTransaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  corporateAccountId: string;

  @Column({ type: 'enum', enum: TransactionDirection })
  direction: TransactionDirection;

  @Column({ type: 'decimal', precision: 14, scale: 2 })
  amount: string;

  @Column({ type: 'decimal', precision: 14, scale: 2 })
  balanceAfter: string;

  @Column({ type: 'varchar', nullable: true })
  referenceId: string | null;

  @Column({ type: 'varchar', nullable: true })
  description: string | null;

  // Which employee actually incurred this - null for a manual top-up
  // (nobody "spent" it, the owner funded the account) but always set
  // for a ride/delivery debit. What makes employee-level and
  // department-level spend reporting possible at all - without this,
  // a transaction was only ever attributable to the account as a
  // whole. department is denormalized at transaction time (the
  // employee's department AS OF this transaction), so moving an
  // employee to a new department later doesn't rewrite their spend
  // history under the new one.
  @Index()
  @Column({ type: 'varchar', nullable: true })
  employeeUserId: string | null;

  @Column({ type: 'varchar', nullable: true })
  department: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
