import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum NotificationChannel {
  PUSH = 'push',
  SMS = 'sms',
  EMAIL = 'email',
  WHATSAPP = 'whatsapp',
  IN_APP = 'in_app',
}

export enum NotificationStatus {
  PENDING = 'pending',
  SENT = 'sent',
  FAILED = 'failed',
  // Simulated sends (no provider credentials configured) are flagged
  // distinctly from a real SENT so nobody mistakes a dev-mode log line for
  // an actual delivered SMS/email/push.
  SIMULATED = 'simulated',
}

// Lets a client group its notification list into tabs/sections instead
// of one flat feed — added because nothing let a passenger (or future
// driver-app screen) distinguish "your ride is here" from "your card
// payment failed" from "here's 10% off" without parsing the title text.
export enum NotificationCategory {
  RIDE = 'ride',
  WALLET = 'wallet',
  PROMOTION = 'promotion',
  SUPPORT = 'support',
  SECURITY = 'security',
  GENERAL = 'general',
}

@Entity('notifications')
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  userId: string;

  @Column({ type: 'enum', enum: NotificationChannel })
  channel: NotificationChannel;

  @Column({ type: 'enum', enum: NotificationCategory, default: NotificationCategory.GENERAL })
  category: NotificationCategory;

  @Column()
  title: string;

  @Column('text')
  body: string;

  @Column({ type: 'enum', enum: NotificationStatus, default: NotificationStatus.PENDING })
  status: NotificationStatus;

  @Column({ default: false })
  isRead: boolean;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @Column({ type: 'varchar', nullable: true })
  failureReason: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
