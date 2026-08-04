import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('sponsored_locations')
export class SponsoredLocation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', nullable: true })
  campaignId: string | null;

  @Column()
  name: string;

  @Column('double precision')
  lat: number;

  @Column('double precision')
  lng: number;

  // How close a passenger's map view needs to be for this pin to show.
  @Column({ type: 'double precision', default: 2 })
  radiusKm: number;

  @Column({ type: 'varchar', nullable: true })
  iconUrl: string | null;

  @Column({ type: 'varchar', nullable: true })
  targetUrl: string | null;

  @Column({ default: 0 })
  impressions: number;

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
