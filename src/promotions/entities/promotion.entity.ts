import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum PromotionType {
  PERCENTAGE = 'percentage', // discount off the fare, applied upfront
  FIXED_AMOUNT = 'fixed_amount', // flat discount off the fare, applied upfront
  CASHBACK = 'cashback', // percentage credited back to wallet AFTER the ride completes
}

@Entity('promotions')
export class Promotion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ unique: true })
  code: string;

  @Column({ type: 'varchar', nullable: true })
  description: string | null;

  @Column({ type: 'enum', enum: PromotionType })
  type: PromotionType;

  // Percentage (0-100) or a fixed NGN amount, depending on `type`.
  @Column({ type: 'decimal', precision: 10, scale: 2 })
  value: string;

  // Caps the discount for percentage-type promos (e.g. "20% off, up to ₦1000").
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  maxDiscountAmount: string | null;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  minFareAmount: string | null;

  @Column({ type: 'int', nullable: true })
  usageLimitTotal: number | null;

  @Column({ type: 'int', default: 1 })
  usageLimitPerUser: number;

  @Column({ type: 'int', default: 0 })
  timesRedeemed: number;

  @Column({ type: 'timestamp', nullable: true })
  validFrom: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  validUntil: Date | null;

  @Column({ default: true })
  isActive: boolean;

  @Column({ type: 'varchar', nullable: true })
  campaignId: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
