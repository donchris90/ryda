import { IsArray, IsBoolean, IsEnum, IsNumber, IsOptional, IsString } from 'class-validator';
import { RideCategory } from '../../common/enums/ride.enum';

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

  // Omit/empty = no restriction. See Airport.eligibleRideCategories doc comment.
  @IsOptional()
  @IsArray()
  @IsEnum(RideCategory, { each: true })
  eligibleRideCategories?: RideCategory[];
}

export class UpdateAirportDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsNumber()
  geofenceRadiusKm?: number;

  @IsOptional()
  @IsArray()
  @IsEnum(RideCategory, { each: true })
  eligibleRideCategories?: RideCategory[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateAirportZoneDto {
  @IsString()
  name: string;

  @IsNumber()
  lat: number;

  @IsNumber()
  lng: number;

  @IsOptional()
  @IsNumber()
  radiusKm?: number;
}

export class UpdateAirportZoneDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsNumber()
  lat?: number;

  @IsOptional()
  @IsNumber()
  lng?: number;

  @IsOptional()
  @IsNumber()
  radiusKm?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
