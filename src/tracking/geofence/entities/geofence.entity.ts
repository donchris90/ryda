import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum GeofenceType {
  RESTRICTED = 'restricted', // driver shouldn't enter — flagged if they do
  ALERT_ZONE = 'alert_zone', // known high-risk area — flagged, not restricted
  SERVICE_AREA = 'service_area', // ride requests should only originate inside these
  SURGE_ZONE = 'surge_zone', // informational boundary for a named surge area
}

@Entity('geofences')
export class Geofence {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Index()
  @Column({ type: 'enum', enum: GeofenceType })
  type: GeofenceType;

  @Column('double precision')
  centerLat: number;

  @Column('double precision')
  centerLng: number;

  @Column('double precision')
  radiusKm: number;

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
