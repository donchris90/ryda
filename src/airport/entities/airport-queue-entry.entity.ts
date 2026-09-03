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

  // Captured at join time from the driver's active vehicle (see
  // AirportService.joinQueue()) - lets dispatchNext() prefer a
  // category match over blind FIFO order. Nullable only because
  // queue entries created before this column existed have no value
  // to backfill from.
  @Column({ type: 'varchar', nullable: true })
  vehicleCategory: string | null;

  @Column({ type: 'enum', enum: AirportQueueStatus, default: AirportQueueStatus.WAITING })
  status: AirportQueueStatus;

  @CreateDateColumn()
  joinedAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  dispatchedAt: Date | null;
}
