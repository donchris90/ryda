import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { DriverLevel } from '../../common/enums/driver-level.enum';
import {
  DriverApprovalStatus,
  DriverAvailability,
  KycStatus,
} from '../../common/enums/driver-status.enum';

@Entity('driver_profiles')
export class DriverProfile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column()
  userId: string;

  @OneToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'enum', enum: DriverLevel, default: DriverLevel.ROOKIE })
  level: DriverLevel;

  @Column({
    type: 'enum',
    enum: DriverApprovalStatus,
    default: DriverApprovalStatus.PENDING,
  })
  approvalStatus: DriverApprovalStatus;

  @Column({ type: 'enum', enum: KycStatus, default: KycStatus.NOT_STARTED })
  kycStatus: KycStatus;

  @Column({
    type: 'enum',
    enum: DriverAvailability,
    default: DriverAvailability.OFFLINE,
  })
  availability: DriverAvailability;

  @Column({ type: 'varchar', nullable: true })
  city: string | null;

  @Column({ type: 'decimal', precision: 3, scale: 2, default: 5.0 })
  rating: string;

  @Column({ default: 0 })
  ratingCount: number;

  @Column({ default: 0 })
  totalTrips: number;

  @Column({ default: 0 })
  completedTrips: number;

  @Column({ default: 0 })
  cancelledTrips: number;

  // Overrides the level-based default commission when set (percent 0-100).
  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  commissionOverridePercent: string | null;

  @Column({ type: 'varchar', nullable: true })
  activeVehicleId: string | null;

  // Set when this driver is dispatched by a fleet company rather than
  // driving independently — changes where ride earnings land (see
  // RidesService.creditDriverEarnings).
  @Column({ type: 'varchar', nullable: true })
  fleetCompanyId: string | null;

  @Column({ type: 'varchar', nullable: true })
  licenseNumber: string | null;

  @Column({ type: 'timestamp', nullable: true })
  licenseExpiry: Date | null;

  // Last known GPS position, used for proximity-based dispatch.
  @Column({ type: 'double precision', nullable: true })
  currentLat: number | null;

  @Column({ type: 'double precision', nullable: true })
  currentLng: number | null;

  @Column({ type: 'timestamp', nullable: true })
  locationUpdatedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
