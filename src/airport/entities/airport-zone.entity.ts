import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * A named pickup/dropoff point within an airport - "Terminal 1
 * Arrivals", "Terminal 2 Departures", "Cargo Village" - distinct from
 * Airport itself, which is one big geofence covering the whole
 * facility. A single airport can have several zones; a zone's own
 * radiusKm is deliberately much smaller than the airport's
 * geofenceRadiusKm (curbside precision, not "somewhere on the
 * grounds").
 */
@Entity('airport_zones')
export class AirportZone {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  airportId: string;

  @Column()
  name: string;

  @Column('double precision')
  lat: number;

  @Column('double precision')
  lng: number;

  @Column({ type: 'double precision', default: 0.3 })
  radiusKm: number;

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
