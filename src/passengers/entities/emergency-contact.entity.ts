import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('emergency_contacts')
export class EmergencyContact {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  userId: string;

  @Column()
  name: string;

  @Column()
  phone: string;

  @Column({ type: 'varchar', nullable: true })
  relationship: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
