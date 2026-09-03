import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum RideOfferStatus {
  PENDING = 'pending',
  ACCEPTED = 'accepted',
  DECLINED = 'declined',
  EXPIRED = 'expired',
  SUPERSEDED = 'superseded', // ride got accepted a different way (e.g. broadcast) while this offer was still open
}

@Entity('ride_offers')
export class RideOffer {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  rideId: string;

  @Index()
  @Column()
  driverUserId: string;

  @Column({ type: 'enum', enum: RideOfferStatus, default: RideOfferStatus.PENDING })
  status: RideOfferStatus;

  @Column('double precision')
  distanceKm: number;

  // Straight-line-distance fallback ETA (see fallbackEtaMinutes in
  // geo.util.ts) - genuine routing isn't fetched per offer to avoid a
  // Google Directions call on every single dispatch attempt. Nullable
  // only because rows created before this column existed have nothing
  // to backfill from.
  @Column({ type: 'integer', nullable: true })
  etaMinutes: number | null;

  // What this driver would actually take home if they complete this
  // ride - the ride's totalFare minus this driver's own resolved
  // commission rate (override, or DriverLevel/vehicle/city-based) at
  // the moment the offer was made. An estimate, not a promise: tips
  // aren't known yet, and settlement re-resolves commission fresh
  // rather than reading this back. Nullable for the same
  // pre-existing-rows reason as etaMinutes above.
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  estimatedDriverEarnings: string | null;

  @CreateDateColumn()
  offeredAt: Date;

  @Column({ type: 'timestamp' })
  expiresAt: Date;
}
