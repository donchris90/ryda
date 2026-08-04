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

  @CreateDateColumn()
  createdAt: Date;
}
