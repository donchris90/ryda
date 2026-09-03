import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum LedgerDiscrepancyStatus {
  OPEN = 'open',
  RESOLVED = 'resolved',
}

export enum LedgerAccountType {
  WALLET = 'wallet',
  FLEET_WALLET = 'fleet_wallet',
  CORPORATE_ACCOUNT = 'corporate_account',
}

/**
 * An account (passenger/driver wallet, fleet wallet, or corporate
 * account - all three use the identical row-locked atomic
 * balance+ledger pattern, confirmed during the Batch 4 audit) whose
 * recorded balance doesn't match what its own transaction ledger says
 * it should be - see LedgerAuditService. Under normal operation this
 * should never happen at all: every balance change already goes
 * through the relevant service's debit()/credit() equivalent, which
 * updates the balance and appends the matching ledger row inside a
 * single atomic, row-locked transaction. A row appearing here means
 * either a genuine bug, a balance mutated outside that path, or ledger
 * rows that were altered/deleted after the fact - each is exactly the
 * kind of thing "financial immutability" and "identify discrepancies
 * automatically" exist to catch.
 */
@Entity('ledger_discrepancies')
export class LedgerDiscrepancy {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'enum', enum: LedgerAccountType, default: LedgerAccountType.WALLET })
  accountType: LedgerAccountType;

  @Index()
  @Column()
  walletId: string;

  @Column({ type: 'decimal', precision: 14, scale: 2 })
  walletBalance: string;

  @Column({ type: 'decimal', precision: 14, scale: 2 })
  ledgerBalance: string;

  @Column({ type: 'decimal', precision: 14, scale: 2 })
  difference: string;

  @Index()
  @Column({ type: 'enum', enum: LedgerDiscrepancyStatus, default: LedgerDiscrepancyStatus.OPEN })
  status: LedgerDiscrepancyStatus;

  @Column({ type: 'varchar', nullable: true })
  resolvedBy: string | null;

  @Column({ type: 'varchar', nullable: true })
  resolutionNote: string | null;

  @CreateDateColumn()
  detectedAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  resolvedAt: Date | null;
}
