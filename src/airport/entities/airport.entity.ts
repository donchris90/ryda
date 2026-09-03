import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('airports')
export class Airport {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Index({ unique: true })
  @Column({ unique: true })
  iataCode: string;

  @Column()
  city: string;

  @Column('double precision')
  lat: number;

  @Column('double precision')
  lng: number;

  // Trips with a pickup/dropoff inside this radius are eligible for the
  // airport surcharge and count as "at the airport" for queue purposes.
  @Column({ type: 'double precision', default: 2 })
  geofenceRadiusKm: number;

  // null/empty = no restriction, every ride category can be picked up
  // here. Non-empty = only these categories are allowed to be
  // dispatched for an airport pickup at this airport (e.g. an
  // international terminal that bars bikes/kekes airside - though
  // RideCategory itself currently only has economy/comfort; this
  // exists so a future category-level restriction has somewhere to
  // live without another migration).
  @Column({ type: 'jsonb', nullable: true })
  eligibleRideCategories: string[] | null;

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
