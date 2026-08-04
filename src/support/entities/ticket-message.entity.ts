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

  @CreateDateColumn()
  createdAt: Date;
}
