import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum RiskAlertType {
  GPS_STALE = 'gps_stale',
  EXCESSIVE_SPEED = 'excessive_speed',
  UNUSUAL_STOP = 'unusual_stop',
  ROUTE_DEVIATION = 'route_deviation',
  TRIP_DURATION_ANOMALY = 'trip_duration_anomaly',
  UNEXPECTED_TERMINATION = 'unexpected_termination',
}

export enum RiskAlertStatus {
  OPEN = 'open',
  REVIEWED = 'reviewed',
  DISMISSED = 'dismissed',
}

/**
 * A pattern-based signal for human review - never a verdict. The
 * `details` field records what was actually measured (a speed
 * reading, an elapsed duration, a distance ratio) in neutral,
 * descriptive terms, deliberately never framed as an accusation
 * ("driver is speeding") - see SafetyMonitoringService's own doc
 * comment for why this distinction is enforced at the point every
 * alert is created, not left to whoever reads it later.
 */
@Entity('risk_alerts')
export class RiskAlert {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'enum', enum: RiskAlertType })
  type: RiskAlertType;

  @Index()
  @Column({ type: 'varchar', nullable: true })
  rideId: string | null;

  @Index()
  @Column({ type: 'varchar', nullable: true })
  driverUserId: string | null;

  @Column('text')
  description: string;

  @Column({ type: 'jsonb', nullable: true })
  details: Record<string, unknown> | null;

  @Column({ type: 'double precision', nullable: true })
  lat: number | null;

  @Column({ type: 'double precision', nullable: true })
  lng: number | null;

  @Index()
  @Column({ type: 'enum', enum: RiskAlertStatus, default: RiskAlertStatus.OPEN })
  status: RiskAlertStatus;

  @Column({ type: 'varchar', nullable: true })
  reviewedBy: string | null;

  @Column({ type: 'varchar', nullable: true })
  reviewNotes: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  reviewedAt: Date | null;
}
