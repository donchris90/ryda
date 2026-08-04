import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('audit_logs')
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Null for unauthenticated actions (e.g. a failed login attempt where we
  // don't know who it was).
  @Index()
  @Column({ type: 'varchar', nullable: true })
  actorUserId: string | null;

  @Column({ type: 'varchar', nullable: true })
  actorRole: string | null;

  // e.g. "driver.approve", "payment.refund", "auth.login.failed"
  @Index()
  @Column()
  action: string;

  @Column({ type: 'varchar', nullable: true })
  targetType: string | null;

  @Index()
  @Column({ type: 'varchar', nullable: true })
  targetId: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @Column({ type: 'varchar', nullable: true })
  ipAddress: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
