import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('otp_codes')
export class OtpCode {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  destination: string; // phone number or email

  @Column()
  code: string;

  @Column({ default: false })
  isUsed: boolean;

  // Wrong-code attempts against THIS otp row — separate from the generic
  // per-IP throttle on the endpoint, since that alone doesn't stop someone
  // patiently brute-forcing a single destination's 6-digit code over many
  // minutes from different IPs.
  @Column({ default: 0 })
  attemptCount: number;

  @Column()
  expiresAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}
