import { IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateAirportDto {
  @IsString()
  name: string;

  @IsString()
  iataCode: string;

  @IsString()
  city: string;

  @IsNumber()
  lat: number;

  @IsNumber()
  lng: number;

  @IsOptional()
  @IsNumber()
  geofenceRadiusKm?: number;
}
