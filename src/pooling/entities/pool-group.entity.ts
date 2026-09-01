import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum PoolGroupStatus {
  // Both member rides have been paired but neither has a driver yet —
  // waiting for the anchor ride's normal dispatch (AUTO) to succeed.
  MATCHED = 'matched',
  // A driver has accepted the anchor ride and been propagated onto the
  // partner ride too — see RidesService.acceptRide()'s pool propagation
  // hook.
  DISPATCHED = 'dispatched',
  // Trip is underway (anchor ride moved to IN_PROGRESS).
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  // One side cancelled (before or after a driver was assigned) and the
  // other side was unpooled back to a normal solo ride rather than being
  // dragged down with it. Terminal — a fresh PoolGroup is created for
  // any future pairing, never reused.
  UNWOUND = 'unwound',
}

export type PoolStopType = 'pickup' | 'dropoff';

export interface PoolRouteStop {
  type: PoolStopType;
  rideId: string;
  lat: number;
  lng: number;
  address: string;
}

/**
 * A matched pair of pooled ride requests sharing one vehicle run. Each
 * member `Ride` row keeps its own passenger, fare, status, rating, and
 * payment — exactly like a solo ride — so the rest of the codebase
 * (payments, tracking, ratings, admin) needs no changes to keep working
 * per-ride. This table only holds what's genuinely shared: which two
 * rides are paired, in what stop order, and the group's own lifecycle.
 *
 * Deliberately NOT the dispatch target itself — see PoolMatchingService's
 * class doc comment for why one member ride (the "anchor") goes through
 * the existing single-ride CandidateSearch/AutoDispatch pipeline
 * unmodified, and the other ride's driver assignment is just propagated
 * onto it after acceptance rather than dispatched independently.
 */
@Entity('pool_groups')
export class PoolGroup {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({
    type: 'enum',
    enum: PoolGroupStatus,
    default: PoolGroupStatus.MATCHED,
  })
  status: PoolGroupStatus;

  // The ride whose own SEARCHING/dispatch lifecycle drives the whole
  // group. Its driverId/vehicleId/acceptedAt etc. are the source of
  // truth, propagated onto the partner ride once set.
  @Column()
  anchorRideId: string;

  @Column()
  partnerRideId: string;

  @Column({ type: 'varchar', nullable: true })
  city: string | null;

  // Chosen stop ordering across both rides' pickup/dropoff points —
  // whichever of the valid orderings (each rider's pickup must precede
  // their own dropoff) had the lowest combined haversine distance at
  // match time. Consumed by the driver app to build the pickup/dropoff
  // sequence; also mirrored onto each member Ride's own `stops` column
  // so no driver-app changes are required to at least see it.
  @Column({ type: 'jsonb' })
  routeSequence: PoolRouteStop[];

  @Column({ type: 'double precision', nullable: true })
  estimatedTotalDistanceKm: number | null;

  @Column({ type: 'double precision', nullable: true })
  estimatedTotalDurationMin: number | null;

  @Column({ type: 'timestamp', nullable: true })
  matchedAt: Date | null;

  @Column({ type: 'varchar', nullable: true })
  unwindReason: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
