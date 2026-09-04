import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum CorporateApprovalStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

/**
 * A corporate ride whose fare exceeded the account's soft approval
 * threshold (CorporateAccount.requiresApprovalAboveFare) - flagged
 * for a manager to review AFTER it happened, not a gate the ride was
 * held behind. The ride itself already ran in real time (the same
 * way every other corporate ride does) and was already billed to the
 * account's budget; rejecting a flagged ride here is a record for
 * the company's own accountability/reimbursement process, not a
 * reversal of the ride or its charge - see CorporateService's own
 * reasoning on why this is deliberately not a real-time block.
 */
@Entity('corporate_ride_approvals')
export class CorporateRideApproval {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  corporateAccountId: string;

  @Index({ unique: true })
  @Column()
  rideId: string;

  @Column()
  employeeUserId: string;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  fareAmount: string;

  @Column({ type: 'enum', enum: CorporateApprovalStatus, default: CorporateApprovalStatus.PENDING })
  status: CorporateApprovalStatus;

  @Column({ type: 'varchar', nullable: true })
  reviewedBy: string | null;

  @Column({ type: 'varchar', nullable: true })
  reviewNotes: string | null;

  @Column({ type: 'timestamp', nullable: true })
  reviewedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}
