import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('refresh_tokens')
export class RefreshToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  userId: string;

  // SHA-256 hash of the JWT refresh token string (deterministic — needed for
  // exact-match lookup). The token itself is already a high-entropy signed
  // secret, so a fast deterministic hash is fine here; this isn't a password.
  @Index({ unique: true })
  @Column({ unique: true })
  tokenHash: string;

  @Column({ default: false })
  revoked: boolean;

  @Column()
  expiresAt: Date;

  // Session context, captured at issue time - what "session management"
  // (listing/revoking individual logins) and suspicious-login detection
  // both need to show/compare. All nullable: a client that sends no
  // deviceFingerprint (e.g. a browser) or a request the server couldn't
  // get a real IP for still gets a session row, just a less descriptive
  // one - never blocks issuing the token over missing context.
  @Column({ type: 'varchar', nullable: true })
  deviceFingerprint: string | null;

  @Column({ type: 'varchar', nullable: true })
  ipAddress: string | null;

  @Column({ type: 'varchar', nullable: true })
  userAgent: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
