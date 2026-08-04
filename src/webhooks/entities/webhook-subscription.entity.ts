import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('webhook_subscriptions')
export class WebhookSubscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  partnerName: string;

  @Column()
  url: string;

  // Used to HMAC-sign outgoing payloads (x-ryda-signature header) so the
  // partner can verify the call actually came from us.
  @Column()
  secret: string;

  @Column('simple-array')
  events: string[];

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
