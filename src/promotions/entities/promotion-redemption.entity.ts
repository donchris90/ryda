import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('promotion_redemptions')
export class PromotionRedemption {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  promotionId: string;

  @Index()
  @Column()
  userId: string;

  @Column({ type: 'varchar', nullable: true })
  rideId: string | null;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  discountAmount: string;

  @CreateDateColumn()
  redeemedAt: Date;
}
