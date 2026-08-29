import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { DriverProfile } from './driver-profile.entity';
import { DriverService, ServiceApprovalStatus } from '../../common/enums/driver-service.enum';

/**
 * One row per (driver, service) pair. This is deliberately NOT folded
 * into a single `driverProfiles.approvedServices` array column: an
 * array can't hold per-service metadata (who approved it, when, why it
 * was rejected) and can't be queried/joined against as cheaply for
 * dispatch eligibility. A driver has at most one row per DriverService
 * value (enforced by the unique index below) — "requested twice" just
 * updates the existing row rather than creating a duplicate.
 */
@Entity('driver_service_capabilities')
@Index(['driverProfileId', 'service'], { unique: true })
export class DriverServiceCapability {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  driverProfileId: string;

  @ManyToOne(() => DriverProfile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'driverProfileId' })
  driverProfile: DriverProfile;

  @Column({ type: 'enum', enum: DriverService })
  service: DriverService;

  @Column({
    type: 'enum',
    enum: ServiceApprovalStatus,
    default: ServiceApprovalStatus.PENDING,
  })
  status: ServiceApprovalStatus;

  @Column({ type: 'timestamp', nullable: true })
  decidedAt: Date | null;

  // The admin user who approved/rejected this, if any decision has been made yet.
  @Column({ type: 'varchar', nullable: true })
  decidedByUserId: string | null;

  @Column({ type: 'varchar', nullable: true })
  rejectionReason: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
