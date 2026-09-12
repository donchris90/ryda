import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export enum CallStatus {
  RINGING = 'ringing',
  ACCEPTED = 'accepted',
  REJECTED = 'rejected',
  ONGOING = 'ongoing',
  ENDED = 'ended',
  MISSED = 'missed',
}

/**
 * One row per in-app WebRTC call attempt. Unlike the earlier Africa's
 * Talking Voice version of this table, no phone number ever appears
 * here - the whole point of going in-app is that neither party's
 * number is involved anywhere in the flow. This row exists purely for
 * call history / support disputes ("the driver says the passenger
 * never called") and so TrackingGateway can look up a call's current
 * state when routing signaling messages.
 */
@Entity('call_logs')
export class CallLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  rideId: string;

  @Column()
  callerId: string;

  @Column()
  calleeId: string;

  @Column({ type: 'enum', enum: CallStatus, default: CallStatus.RINGING })
  status: CallStatus;

  @Column({ type: 'timestamp', nullable: true })
  acceptedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  endedAt: Date | null;

  @Column({ type: 'int', nullable: true })
  durationSeconds: number | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
