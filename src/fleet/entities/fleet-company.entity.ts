import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('fleet_companies')
export class FleetCompany {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  ownerUserId: string;

  @Column()
  name: string;

  @Column({ type: 'varchar', nullable: true })
  registrationNumber: string | null;

  @Column({ type: 'varchar', nullable: true })
  city: string | null;

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
