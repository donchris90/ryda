import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export enum CallStatus {
  INITIATED = 'initiated',
  RINGING = 'ringing',
  BRIDGED = 'bridged',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

/**
 * One row per masked ride call. The bridgeToPhone column exists solely
 * so CallsController.voiceCallback can resolve "who do we connect this
 * leg to" from the Africa's Talking sessionId alone — AT's voice
 * callback URL is a fixed account-level setting, not something we can
 * parameterize per-call, so the sessionId round-trip is the only
 * correlation handle we get back from initiateCall(). Never exposed
 * through any API response — CallsService only ever returns a bare
 * { status } to client apps.
 */
@Entity('call_logs')
export class CallLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  rideId: string;

  @Column()
  initiatedByUserId: string;

  @Column()
  calleeUserId: string;

  @Index()
  @Column({ nullable: true })
  providerSessionId: string | null;

  @Column()
  bridgeToPhone: string;

  @Column({ type: 'enum', enum: CallStatus, default: CallStatus.INITIATED })
  status: CallStatus;

  @Column({ type: 'int', nullable: true })
  durationSeconds: number | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
