import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum IncidentType {
  SOS = 'sos',
  SAFETY_CONCERN = 'safety_concern',
  ACCIDENT = 'accident',
  OTHER = 'other',
}

export enum IncidentStatus {
  OPEN = 'open',
  ACKNOWLEDGED = 'acknowledged',
  RESPONDING = 'responding',
  ESCALATED = 'escalated',
  RESOLVED = 'resolved',
  CLOSED = 'closed',
}

export enum IncidentSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

@Entity('incidents')
export class Incident {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'enum', enum: IncidentType })
  type: IncidentType;

  // SOS is always CRITICAL by design (see EmergencyService.triggerSos())
  // - other incident types default lower and can be raised by a
  // responder as they investigate.
  @Column({ type: 'enum', enum: IncidentSeverity, default: IncidentSeverity.MEDIUM })
  severity: IncidentSeverity;

  @Index()
  @Column()
  reportedByUserId: string;

  @Index()
  @Column({ type: 'varchar', nullable: true })
  rideId: string | null;

  @Index()
  @Column({ type: 'enum', enum: IncidentStatus, default: IncidentStatus.OPEN })
  status: IncidentStatus;

  @Column('text')
  description: string;

  @Column({ type: 'double precision', nullable: true })
  lat: number | null;

  @Column({ type: 'double precision', nullable: true })
  lng: number | null;

  @Column({ type: 'varchar', nullable: true })
  acknowledgedBy: string | null;

  @Column({ type: 'varchar', nullable: true })
  respondingBy: string | null;

  @Column({ type: 'varchar', nullable: true })
  escalatedBy: string | null;

  @Column({ type: 'varchar', nullable: true })
  escalationReason: string | null;

  @Column({ type: 'timestamp', nullable: true })
  escalatedAt: Date | null;

  @Column({ type: 'varchar', nullable: true })
  resolvedBy: string | null;

  @Column({ type: 'varchar', nullable: true })
  resolutionNotes: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  resolvedAt: Date | null;
}
