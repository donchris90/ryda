import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum TicketCategory {
  GENERAL = 'general',
  RIDE_ISSUE = 'ride_issue',
  PAYMENT_ISSUE = 'payment_issue',
  WALLET_ISSUE = 'wallet_issue',
  PACKAGE_ISSUE = 'package_issue',
  ACCOUNT_ISSUE = 'account_issue',
  LOST_ITEM = 'lost_item',
  SAFETY = 'safety',
}

export enum TicketStatus {
  OPEN = 'open',
  IN_PROGRESS = 'in_progress',
  RESOLVED = 'resolved',
  CLOSED = 'closed',
}

export enum TicketPriority {
  LOW = 'low',
  NORMAL = 'normal',
  HIGH = 'high',
  URGENT = 'urgent',
}

@Entity('support_tickets')
export class SupportTicket {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  userId: string;

  @Column({ type: 'enum', enum: TicketCategory, default: TicketCategory.GENERAL })
  category: TicketCategory;

  @Column()
  subject: string;

  @Column('text')
  description: string;

  @Index()
  @Column({ type: 'enum', enum: TicketStatus, default: TicketStatus.OPEN })
  status: TicketStatus;

  @Column({ type: 'enum', enum: TicketPriority, default: TicketPriority.NORMAL })
  priority: TicketPriority;

  // Set when this ticket is about a specific trip (dispute, lost item, safety report).
  @Index()
  @Column({ type: 'varchar', nullable: true })
  rideId: string | null;

  @Column({ type: 'varchar', nullable: true })
  assignedAgentId: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  resolvedAt: Date | null;
}
