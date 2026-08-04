import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum FleetStaffRole {
  OWNER = 'owner',
  MANAGER = 'manager',
}

@Entity('fleet_staff')
export class FleetStaff {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  fleetCompanyId: string;

  // A staff member (owner or manager) belongs to exactly one fleet company.
  @Index({ unique: true })
  @Column({ unique: true })
  userId: string;

  @Column({ type: 'enum', enum: FleetStaffRole })
  role: FleetStaffRole;

  @CreateDateColumn()
  createdAt: Date;
}
