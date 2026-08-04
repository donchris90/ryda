import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('incident_timeline_entries')
export class IncidentTimelineEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  incidentId: string;

  // Null for system-generated entries (e.g. "SOS triggered").
  @Column({ type: 'varchar', nullable: true })
  actorUserId: string | null;

  @Column()
  action: string;

  @Column({ type: 'varchar', nullable: true })
  notes: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
