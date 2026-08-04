import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum FavouritePlaceType {
  HOME = 'home',
  WORK = 'work',
  OTHER = 'other',
}

@Entity('favourite_places')
export class FavouritePlace {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  userId: string;

  @Column({ type: 'enum', enum: FavouritePlaceType, default: FavouritePlaceType.OTHER })
  type: FavouritePlaceType;

  @Column()
  label: string;

  @Column('double precision')
  lat: number;

  @Column('double precision')
  lng: number;

  @Column()
  address: string;

  @CreateDateColumn()
  createdAt: Date;
}
