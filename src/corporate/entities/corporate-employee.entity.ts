import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('corporate_employees')
export class CorporateEmployee {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  corporateAccountId: string;

  // A user can belong to at most one corporate account at a time.
  @Index({ unique: true })
  @Column({ unique: true })
  userId: string;

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
