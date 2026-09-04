import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { SplitFareParticipant } from './split-fare-participant.entity';

export enum SplitFareStatus {
  PENDING = 'pending', // waiting on one or more participants to pay
  COMPLETED = 'completed', // everyone has paid their share
  CANCELLED = 'cancelled',
  // Still-PENDING participants never paid before expiresAt - the
  // initiator is left reimbursed only for whoever did pay (see
  // SplitFareService.expireStaleRequests()'s own comment on why
  // nothing further needs to happen financially).
  EXPIRED = 'expired',
}

@Entity('split_fare_requests')
export class SplitFareRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column()
  rideId: string;

  @Column()
  initiatorId: string;

  @Column('decimal', { precision: 12, scale: 2 })
  totalAmount: string;

  @Column({ type: 'enum', enum: SplitFareStatus, default: SplitFareStatus.PENDING })
  status: SplitFareStatus;

  @OneToMany(() => SplitFareParticipant, (p) => p.splitRequest)
  participants: SplitFareParticipant[];

  // Set at creation from the admin-configurable expiry window - never
  // recomputed afterward, so it always reflects how long the
  // participants who WERE invited actually had to pay, not a moving
  // target. Nullable only for rows created before this existed - the
  // cron treats a null expiresAt as "never expires" rather than
  // guessing a value for old requests.
  @Column({ type: 'timestamp', nullable: true })
  expiresAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}
