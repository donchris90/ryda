import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('corporate_employees')
export class CorporateEmployee {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  corporateAccountId: string;

  // A user can belong to at most one corporate account at a time.
  @Index({ unique: true })
  @Column({ unique: true })
  userId: string;

  @Column({ default: true })
  isActive: boolean;

  // Free-text, matching how city/department-adjacent fields work
  // elsewhere in this codebase (no separate normalized departments
  // table) - simple enough for real company org structures without
  // forcing a rigid taxonomy on every corporate customer.
  @Column({ type: 'varchar', nullable: true })
  department: string | null;

  // Null = no individual limit (still subject to the account-wide
  // policy in CorporateAccount, just nothing employee-specific).
  // Checked against a rolling calendar-month spend total in
  // CorporateService.checkEmployeeSpendLimit() - not stored/decremented
  // here, so changing the limit takes effect immediately rather than
  // needing a reset.
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  monthlySpendLimit: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
