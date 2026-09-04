import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('ticket_messages')
export class TicketMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  ticketId: string;

  @Column()
  senderId: string;

  @Column()
  senderRole: string;

  @Column('text')
  message: string;

  // Uploaded separately via the existing generic POST
  // /storage/upload/support-evidence endpoint - this just links the
  // resulting URL to the message. Null for the overwhelming majority
  // of messages, which are plain text.
  @Column({ type: 'varchar', nullable: true })
  attachmentUrl: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
