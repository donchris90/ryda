import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { SplitFareRequest } from './split-fare-request.entity';

export enum SplitParticipantStatus {
  PENDING = 'pending',
  PAID = 'paid',
}

@Entity('split_fare_participants')
export class SplitFareParticipant {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  splitRequestId: string;

  @ManyToOne(() => SplitFareRequest, (r) => r.participants, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'splitRequestId' })
  splitRequest: SplitFareRequest;

  @Index()
  @Column()
  userId: string; // resolved from phone at creation time — v1 requires participants to be registered Ryda users

  @Column('decimal', { precision: 12, scale: 2 })
  amountOwed: string;

  @Column({ type: 'enum', enum: SplitParticipantStatus, default: SplitParticipantStatus.PENDING })
  status: SplitParticipantStatus;

  @Column({ type: 'timestamp', nullable: true })
  paidAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}
