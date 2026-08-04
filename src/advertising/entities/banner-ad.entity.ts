import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum BannerPlacement {
  HOME_SCREEN = 'home_screen',
  RIDE_SCREEN = 'ride_screen',
  SEARCH_RESULTS = 'search_results',
  RECEIPT = 'receipt',
}

@Entity('banner_ads')
export class BannerAd {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', nullable: true })
  campaignId: string | null;

  @Column()
  title: string;

  @Column()
  imageUrl: string;

  @Column()
  targetUrl: string;

  @Index()
  @Column({ type: 'enum', enum: BannerPlacement })
  placement: BannerPlacement;

  @Column({ default: 0 })
  impressions: number;

  @Column({ default: 0 })
  clicks: number;

  @Column({ default: true })
  isActive: boolean;

  @Column({ type: 'timestamp', nullable: true })
  startDate: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  endDate: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
