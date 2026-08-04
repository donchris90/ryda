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

  @CreateDateColumn()
  createdAt: Date;
}
