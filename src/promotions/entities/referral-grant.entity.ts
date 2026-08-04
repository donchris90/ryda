import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('referral_grants')
export class ReferralGrant {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  referrerUserId: string;

  // Unique: a referee can only ever trigger one grant, on their first
  // completed ride, no matter how many times completeRide might be checked.
  @Index({ unique: true })
  @Column({ unique: true })
  refereeUserId: string;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  referrerBonus: string;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  refereeBonus: string;

  @CreateDateColumn()
  createdAt: Date;
}
