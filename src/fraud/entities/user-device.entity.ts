import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('user_devices')
export class UserDevice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  userId: string;

  // Client-generated device identifier (e.g. from a device-info library on
  // mobile). Not cryptographically unspoofable, but catches casual abuse —
  // the same person reusing one device across many accounts.
  @Index()
  @Column()
  fingerprint: string;

  @Column({ type: 'varchar', nullable: true })
  ipAddress: string | null;

  @CreateDateColumn()
  firstSeenAt: Date;

  @UpdateDateColumn()
  lastSeenAt: Date;
}
