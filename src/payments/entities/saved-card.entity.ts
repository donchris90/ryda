import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('saved_cards')
export class SavedCard {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  userId: string;

  // Paystack's reusable authorization code — this, not the card number, is
  // what gets charged on subsequent rides.
  @Column({ unique: true })
  authorizationCode: string;

  @Column({ type: 'varchar', nullable: true })
  last4: string | null;

  @Column({ type: 'varchar', nullable: true })
  cardType: string | null;

  @Column({ type: 'varchar', nullable: true })
  bank: string | null;

  @Column({ default: false })
  isDefault: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
