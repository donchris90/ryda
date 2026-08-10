import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { DeliveryVehicleType } from './delivery-order.entity';

@Entity('delivery_vehicle_type_configs')
export class DeliveryVehicleTypeConfig {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ type: 'enum', enum: DeliveryVehicleType })
  vehicleType: DeliveryVehicleType;

  @Column('decimal', { precision: 12, scale: 2 })
  baseFare: string;

  @Column('decimal', { precision: 12, scale: 2 })
  perKm: string;

  @Column('decimal', { precision: 12, scale: 2 })
  perKg: string;

  @Column('decimal', { precision: 12, scale: 2 })
  minimumFare: string;

  @Column('decimal', { precision: 10, scale: 2 })
  maxWeightKg: string;

  @Column({ type: 'varchar', nullable: true })
  capacityDescription: string | null;

  // Lets admin retire a vehicle type from the passenger-facing
  // selection without deleting its historical config/pricing, which
  // past delivery orders referencing it still depend on for their own
  // records staying meaningful.
  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
