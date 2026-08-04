import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { DriverAvailability } from '../../common/enums/driver-status.enum';

/**
 * One row per continuous period a driver spent in a given availability
 * status. Written by DriversService.setAvailability() on every real
 * status change — closes the previous open row (sets endedAt) and opens
 * a new one. A "shift" isn't its own concept with separate start/end
 * actions; it's derived from this log: the continuous run of ONLINE/
 * BREAK rows between two OFFLINE boundaries, matching how Uber/Bolt-style
 * apps actually work — going online *is* starting your shift.
 */
@Entity('driver_availability_logs')
export class DriverAvailabilityLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  driverUserId: string;

  @Column({ type: 'enum', enum: DriverAvailability })
  status: DriverAvailability;

  @CreateDateColumn()
  startedAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  endedAt: Date | null;
}
