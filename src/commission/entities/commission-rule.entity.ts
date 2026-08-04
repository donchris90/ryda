import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { DriverLevel } from '../../common/enums/driver-level.enum';
import { VehicleCategory } from '../../common/enums/vehicle.enum';

/**
 * A commission rule narrows by driverLevel / city / vehicleCategory.
 * Null on a field means "applies regardless of that dimension".
 * The commission engine picks the most specific matching rule.
 */
@Entity('commission_rules')
export class CommissionRule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'enum', enum: DriverLevel, nullable: true })
  driverLevel: DriverLevel | null;

  @Column({ type: 'varchar', nullable: true })
  city: string | null;

  @Column({ type: 'enum', enum: VehicleCategory, nullable: true })
  vehicleCategory: VehicleCategory | null;

  @Column({ type: 'decimal', precision: 5, scale: 2 })
  commissionPercent: string;

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
