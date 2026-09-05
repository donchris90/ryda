import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * A periodic statement, not a bill to be paid - CorporateAccount is a
 * prepaid budgetBalance the owner tops up themselves (see
 * CorporateService.applyLedgerChange()), so there's no outstanding
 * amount an invoice could ever demand payment for. What this actually
 * gives an account owner is the same thing a bank statement gives a
 * depositor: an immutable, dated summary of what moved through the
 * account in a given period and what the balance was at each end of
 * it - for expense reporting and reconciliation, not collection.
 *
 * Deliberately stores only the aggregate figures, not a duplicated
 * copy of every CorporateTransaction in the period - the itemized
 * line-item breakdown a person actually wants to see is queried live
 * from CorporateTransaction by period at read time (see
 * CorporateService.getInvoiceDetail()), so there is exactly one
 * source of truth for what happened on any given transaction, ever.
 * This row's job is just to record that a period was closed off and
 * what its totals were at the moment it was generated - a real
 * requirement, since a transaction row itself never expires or gets
 * archived, but "the statement I already sent the finance team for
 * March" needs to stay exactly what it said even if something else
 * about historical transactions were ever recomputed later.
 */
@Entity('corporate_invoices')
@Index(['corporateAccountId', 'periodStart', 'periodEnd'], { unique: true })
export class CorporateInvoice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  corporateAccountId: string;

  // Inclusive start, exclusive end - a calendar month is
  // [periodStart, periodEnd) so there is never an ambiguous instant
  // that could belong to two consecutive invoices.
  @Column({ type: 'timestamptz' })
  periodStart: Date;

  @Column({ type: 'timestamptz' })
  periodEnd: Date;

  @Column({ type: 'decimal', precision: 14, scale: 2 })
  openingBalance: string;

  @Column({ type: 'decimal', precision: 14, scale: 2 })
  closingBalance: string;

  @Column({ type: 'decimal', precision: 14, scale: 2 })
  totalDebits: string;

  @Column({ type: 'decimal', precision: 14, scale: 2 })
  totalCredits: string;

  @Column({ type: 'int' })
  transactionCount: number;

  @Column({ default: 'NGN' })
  currency: string;

  @CreateDateColumn()
  generatedAt: Date;
}
