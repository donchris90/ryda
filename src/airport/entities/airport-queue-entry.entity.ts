import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum AirportQueueStatus {
  WAITING = 'waiting',
  DISPATCHED = 'dispatched',
  LEFT = 'left',
}

@Entity('airport_queue_entries')
export class AirportQueueEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  airportId: string;

  @Index()
  @Column()
  driverUserId: string;

  @Column({ type: 'enum', enum: AirportQueueStatus, default: AirportQueueStatus.WAITING })
  status: AirportQueueStatus;

  @CreateDateColumn()
  joinedAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  dispatchedAt: Date | null;
}
