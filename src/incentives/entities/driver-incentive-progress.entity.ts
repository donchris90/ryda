import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum IncentiveProgressStatus {
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  REWARDED = 'rewarded',
}

@Entity('driver_incentive_progress')
export class DriverIncentiveProgress {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  incentiveId: string;

  @Index()
  @Column()
  driverId: string;

  @Column({ default: 0 })
  tripsCompleted: number;

  // Only meaningful for STREAK — when the current rolling window started.
  @Column({ type: 'timestamp', nullable: true })
  windowStartedAt: Date | null;

  @Column({ type: 'enum', enum: IncentiveProgressStatus, default: IncentiveProgressStatus.IN_PROGRESS })
  status: IncentiveProgressStatus;

  @Column({ type: 'timestamp', nullable: true })
  completedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  rewardedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
