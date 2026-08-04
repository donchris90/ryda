import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { KycStatus } from '../../common/enums/driver-status.enum';

export enum ChatPreference {
  CHATTY = 'chatty',
  QUIET = 'quiet',
  NO_PREFERENCE = 'no_preference',
}

@Entity('passenger_profiles')
export class PassengerProfile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column()
  userId: string;

  @OneToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  // ---- Preferences ----
  @Column({ type: 'varchar', nullable: true })
  preferredLanguage: string | null;

  @Column({ type: 'varchar', nullable: true })
  musicPreference: string | null;

  @Column({ type: 'enum', enum: ChatPreference, default: ChatPreference.NO_PREFERENCE })
  chatPreference: ChatPreference;

  @Column({ default: false })
  wheelchairAccessible: boolean;

  // ---- Verification ----
  @Column({ type: 'enum', enum: KycStatus, default: KycStatus.NOT_STARTED })
  verificationStatus: KycStatus;

  @Column({ type: 'varchar', nullable: true })
  idDocumentUrl: string | null;

  // ---- Blacklist (trust & safety) ----
  @Column({ default: false })
  isBlacklisted: boolean;

  @Column({ type: 'varchar', nullable: true })
  blacklistReason: string | null;

  // ---- Statistics (denormalized, updated as rides complete/cancel) ----
  @Column({ default: 0 })
  totalRides: number;

  @Column({ default: 0 })
  completedRides: number;

  @Column({ default: 0 })
  cancelledRides: number;

  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0 })
  totalSpend: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
