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

  // Admin-only, additive to the default strict category mapping (see
  // ride-vehicle-match.util.ts) - lets an admin manually vouch for a
  // specific vehicle covering ride categories beyond what its raw
  // `category` alone would strictly allow. E.g. a genuinely nice car
  // can be approved for Comfort, XL, or Luxury without needing a
  // separate vehicle category to exist for every possible tier - the
  // real-world judgment of "is this car nice enough" belongs with a
  // human reviewing it, not a rigid enum.
  @Column({ type: 'simple-array', nullable: true })
  approvedRideCategories: string[] | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
