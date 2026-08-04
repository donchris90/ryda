import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { VehicleCategory, VehicleStatus } from '../../common/enums/vehicle.enum';

@Entity('vehicles')
export class Vehicle {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  driverId: string;

  // Set when this vehicle is fleet-owned rather than owned by the driver directly.
  @Index()
  @Column({ type: 'varchar', nullable: true })
  fleetCompanyId: string | null;

  @Column({ type: 'enum', enum: VehicleCategory })
  category: VehicleCategory;

  @Column()
  make: string;

  @Column()
  model: string;

  @Column()
  year: number;

  @Column({ type: 'varchar', nullable: true })
  color: string | null;

  @Index({ unique: true })
  @Column({ unique: true })
  plateNumber: string;

  @Column({ type: 'varchar', nullable: true })
  vin: string | null;

  @Column({ type: 'timestamp', nullable: true })
  insuranceExpiry: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  roadWorthinessExpiry: Date | null;

  @Column({ type: 'varchar', nullable: true })
  photoUrl: string | null;

  @Column({ type: 'enum', enum: VehicleStatus, default: VehicleStatus.PENDING_INSPECTION })
  status: VehicleStatus;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
