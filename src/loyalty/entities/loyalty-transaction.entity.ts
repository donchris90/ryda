import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('loyalty_transactions')
export class LoyaltyTransaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  userId: string;

  @Column()
  direction: 'earned' | 'redeemed';

  @Column()
  points: number;

  @Column()
  reason: string;

  @Column({ type: 'varchar', nullable: true })
  rideId: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
