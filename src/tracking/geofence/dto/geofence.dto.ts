import { IsEnum, IsNumber, IsString, Min } from 'class-validator';
import { GeofenceType } from '../entities/geofence.entity';

export class CreateGeofenceDto {
  @IsString()
  name: string;

  @IsEnum(GeofenceType)
  type: GeofenceType;

  @IsNumber()
  centerLat: number;

  @IsNumber()
  centerLng: number;

  @IsNumber()
  @Min(0.05)
  radiusKm: number;
}
