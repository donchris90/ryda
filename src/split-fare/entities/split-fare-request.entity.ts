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

  @CreateDateColumn()
  createdAt: Date;
}
