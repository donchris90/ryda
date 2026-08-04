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

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
