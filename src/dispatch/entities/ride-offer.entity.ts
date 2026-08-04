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

  @CreateDateColumn()
  offeredAt: Date;

  @Column({ type: 'timestamp' })
  expiresAt: Date;
}
