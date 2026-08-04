import { Column, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export enum LoyaltyTier {
  BRONZE = 'bronze',
  SILVER = 'silver',
  GOLD = 'gold',
  PLATINUM = 'platinum',
}

// Lifetime points thresholds — deliberately based on lifetime points
// earned, not current balance, so redeeming points doesn't demote a
// passenger's tier.
export const TIER_THRESHOLDS: Record<LoyaltyTier, number> = {
  [LoyaltyTier.BRONZE]: 0,
  [LoyaltyTier.SILVER]: 500,
  [LoyaltyTier.GOLD]: 2000,
  [LoyaltyTier.PLATINUM]: 5000,
};

@Entity('loyalty_accounts')
export class LoyaltyAccount {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column()
  userId: string;

  @Column({ default: 0 })
  pointsBalance: number;

  @Column({ default: 0 })
  lifetimePoints: number;

  @Column({ type: 'enum', enum: LoyaltyTier, default: LoyaltyTier.BRONZE })
  tier: LoyaltyTier;

  @UpdateDateColumn()
  updatedAt: Date;
}
