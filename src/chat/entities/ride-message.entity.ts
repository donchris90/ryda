import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('ride_messages')
export class RideMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  rideId: string;

  @Column()
  senderId: string;

  @Column()
  senderRole: 'passenger' | 'driver';

  @Column('text')
  message: string;

  @CreateDateColumn()
  createdAt: Date;
}
