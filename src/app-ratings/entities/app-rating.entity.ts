import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('app_ratings')
export class AppRating {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // One rating per user, upsertable — matches typical app-store rating
  // UX (you can change your mind and re-rate), rather than a one-time,
  // never-editable submission.
  @Index({ unique: true })
  @Column()
  userId: string;

  @Column('smallint')
  rating: number;

  @Column({ type: 'text', nullable: true })
  comment: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
