import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export enum WalletTransferStatus {
  PENDING = 'pending',
  COMPLETED = 'completed',
  EXPIRED = 'expired',
  CANCELLED = 'cancelled',
}

@Entity('wallet_transfer_requests')
export class WalletTransferRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  senderId: string;

  @Index()
  @Column()
  recipientId: string;

  @Column('decimal', { precision: 14, scale: 2 })
  amount: string;

  @Column('decimal', { precision: 14, scale: 2, default: 0 })
  fee: string;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({ type: 'enum', enum: WalletTransferStatus, default: WalletTransferStatus.PENDING })
  status: WalletTransferStatus;

  @Column()
  expiresAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}
