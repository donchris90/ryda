import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum WebhookDeliveryStatus {
  SUCCESS = 'success',
  FAILED = 'failed',
}

@Entity('webhook_delivery_logs')
export class WebhookDeliveryLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  subscriptionId: string;

  @Column()
  event: string;

  @Column('jsonb')
  payload: Record<string, unknown>;

  @Column({ type: 'enum', enum: WebhookDeliveryStatus })
  status: WebhookDeliveryStatus;

  @Column({ type: 'int', nullable: true })
  responseCode: number | null;

  @Column({ type: 'varchar', nullable: true })
  errorMessage: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
