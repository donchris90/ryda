import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

const RETENTION_DAYS = 7;

@Entity('safety_recordings')
export class SafetyRecording {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Every recording belongs to exactly one incident (an SOS trigger
  // creates the incident first, then recording upload attaches to it) -
  // never a bare rideId, so a recording always has the same access
  // rules and audit trail an incident already carries.
  @Index()
  @Column()
  incidentId: string;

  // Denormalized from the incident at upload time rather than always
  // joining back to it - who triggered the SOS is exactly who's allowed
  // to access the recording (see SafetyRecordingsService.canAccess()),
  // and that's worth having directly on this row.
  @Index()
  @Column()
  uploadedByUserId: string;

  @Column({ type: 'varchar', nullable: true })
  rideId: string | null;

  @Column()
  audioUrl: string;

  // StorageService.delete() takes the storage key, not the public URL -
  // stored separately at upload time rather than trying to derive it
  // from audioUrl later (parsing a key back out of a URL is fragile
  // and driver-specific - S3/R2/local disk don't necessarily construct
  // URLs the same way).
  @Column()
  storageKey: string;

  @Column({ type: 'int', nullable: true })
  durationSeconds: number | null;

  @CreateDateColumn()
  createdAt: Date;

  // Set once at creation (createdAt + RETENTION_DAYS), not computed on
  // every read - a fixed, queryable column is what the cleanup cron
  // actually filters on (`WHERE expiresAt < now()`), and fixing it at
  // upload time means the retention window can never silently drift if
  // RETENTION_DAYS is changed later - existing recordings keep whatever
  // window applied when they were created.
  @Index()
  @Column({ type: 'timestamp' })
  expiresAt: Date;

  static computeExpiry(from: Date = new Date()): Date {
    return new Date(from.getTime() + RETENTION_DAYS * 24 * 60 * 60 * 1000);
  }
}
