import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { UserRole } from '../../common/enums/user-role.enum';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', unique: true, nullable: true })
  phone: string | null;

  @Index({ unique: true })
  @Column({ unique: true })
  email: string;

  @Column({ type: 'varchar', nullable: true, select: false })
  passwordHash: string | null;

  // Kept for backward compatibility (e.g. "default landing screen" /
  // display purposes) — always equal to roles[0]. Authorization decisions
  // (RolesGuard, PermissionsGuard) use `roles`, not this field.
  @Column({ type: 'enum', enum: UserRole, default: UserRole.PASSENGER })
  role: UserRole;

  // A single identity (one email/phone/login) can hold more than one role —
  // e.g. someone who is both a passenger and a driver. New roles are added
  // via POST /auth/add-role (authenticated), never silently merged during
  // registration.
  @Column({ type: 'enum', enum: UserRole, array: true, default: [UserRole.PASSENGER] })
  roles: UserRole[];

  @Column()
  firstName: string;

  @Column()
  lastName: string;

  @Column({ type: 'varchar', nullable: true })
  profilePhotoUrl: string | null;

  @Column({ default: false })
  isPhoneVerified: boolean;

  @Column({ default: false })
  isEmailVerified: boolean;

  @Column({ default: true })
  isActive: boolean;

  @Column({ type: 'decimal', precision: 3, scale: 2, default: 5.0 })
  rating: string;

  @Column({ default: 0 })
  ratingCount: number;

  @Column({ type: 'varchar', nullable: true })
  referredByCode: string | null;

  @Index({ unique: true })
  @Column({ unique: true })
  referralCode: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
