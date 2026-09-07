import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('api_keys')
export class ApiKey {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  // SHA-256 hash of the raw key — the raw key is shown exactly once, at
  // creation time, and never stored or retrievable again.
  @Index({ unique: true })
  @Column({ unique: true })
  hashedKey: string;

  // First few characters of the raw key, kept for display ("rk_live_a1b2...")
  // so an admin can identify a key in a list without ever seeing the full secret.
  @Column()
  keyPrefix: string;

  @Column({ type: 'jsonb', default: [] })
  scopes: string[];

  @Column({ default: true })
  isActive: boolean;

  @Column({ type: 'timestamp', nullable: true })
  lastUsedAt: Date | null;

  // Optional - a key with no expiry is valid indefinitely (until
  // revoked). Enforced in ApiKeysService.validate(), not just displayed:
  // the admin dashboard already shows an "Expired" badge computed from
  // this field (api-keys.tsx), which only makes sense as a real,
  // enforced expiry - a badge that says "Expired" on a key that still
  // works would be actively misleading.
  @Column({ type: 'timestamp', nullable: true })
  expiresAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}
