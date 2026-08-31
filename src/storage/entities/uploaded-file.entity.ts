import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type UploadContextType = 'ride' | 'ticket';

/**
 * Records who uploaded a file and, for folders where a file is meaningless
 * without a parent (a chat attachment belongs to a ride, evidence belongs
 * to a ticket), what it's attached to. StorageController.serveLocal() reads
 * this to decide who's allowed to fetch the file back — closing the gap
 * where any authenticated user could read any chat-attachments/
 * support-evidence file just by knowing its UUID filename.
 *
 * driver-documents doesn't need this: DriverDocument already carries that
 * link. vehicle-photos/profile-photos are deliberately not tracked here —
 * see the comment on those folders in storage.controller.ts.
 */
@Entity('uploaded_files')
@Index(['folder', 'filename'], { unique: true })
export class UploadedFile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  folder: string;

  /** Just the UUID.ext part — the same string matched against SAFE_FILENAME in the controller. */
  @Column()
  filename: string;

  @Index()
  @Column()
  uploaderId: string;

  @Column({ type: 'varchar', nullable: true })
  contextType: UploadContextType | null;

  /** rideId when contextType is 'ride', ticketId when 'ticket'. */
  @Column({ type: 'varchar', nullable: true })
  contextId: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
