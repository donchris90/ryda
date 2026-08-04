import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('location_history')
export class LocationHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  driverUserId: string;

  // Set when this ping happened during an active ride — makes it cheap to
  // pull "the route for this specific trip" without a time-range guess.
  @Index()
  @Column({ type: 'varchar', nullable: true })
  rideId: string | null;

  @Column('double precision')
  lat: number;

  @Column('double precision')
  lng: number;

  @CreateDateColumn()
  recordedAt: Date;
}
