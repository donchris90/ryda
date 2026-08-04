import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum IncentiveType {
  STREAK = 'streak', // N trips within a rolling time window
  QUEST = 'quest', // N trips total, one-time reward
  PEAK_HOUR = 'peak_hour', // flat bonus per trip completed within a time window
  MILESTONE = 'milestone', // lifetime trip count milestone, one-time
}

@Entity('incentives')
export class Incentive {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ type: 'varchar', nullable: true })
  description: string | null;

  @Column({ type: 'enum', enum: IncentiveType })
  type: IncentiveType;

  // Used by STREAK / QUEST / MILESTONE.
  @Column({ type: 'int', nullable: true })
  targetTrips: number | null;

  // Used by STREAK only — the rolling window the target must be hit within.
  @Column({ type: 'int', nullable: true })
  windowHours: number | null;

  // Used by PEAK_HOUR only.
  @Column({ type: 'int', nullable: true })
  peakStartHour: number | null;

  @Column({ type: 'int', nullable: true })
  peakEndHour: number | null;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  rewardAmount: string;

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
