import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { GeofenceType } from './geofence.entity';

@Entity('geofence_events')
export class GeofenceEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  geofenceId: string;

  @Column()
  geofenceName: string;

  @Column({ type: 'enum', enum: GeofenceType })
  geofenceType: GeofenceType;

  @Index()
  @Column()
  driverUserId: string;

  @Column('double precision')
  lat: number;

  @Column('double precision')
  lng: number;

  @CreateDateColumn()
  createdAt: Date;
}
