import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export enum OtpPurpose {
  PHONE_VERIFICATION = 'phone_verification',
  WALLET_TRANSFER = 'wallet_transfer',
}

@Entity('otp_codes')
export class OtpCode {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  destination: string; // phone number or email

  // Defaults to the original, only-ever use case so every existing row
  // and every existing caller stays exactly correct with no migration
  // needed beyond the column itself - new purposes are additive, not a
  // breaking change to what already works.
  @Column({ type: 'enum', enum: OtpPurpose, default: OtpPurpose.PHONE_VERIFICATION })
  purpose: OtpPurpose;

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
