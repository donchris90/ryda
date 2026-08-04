import { IsBoolean, IsEnum, IsNumber, IsOptional, IsString } from 'class-validator';
import { ChatPreference } from '../entities/passenger-profile.entity';
import { FavouritePlaceType } from '../entities/favourite-place.entity';

export class UpdatePreferencesDto {
  @IsOptional()
  @IsString()
  preferredLanguage?: string;

  @IsOptional()
  @IsString()
  musicPreference?: string;

  @IsOptional()
  @IsEnum(ChatPreference)
  chatPreference?: ChatPreference;

  @IsOptional()
  @IsBoolean()
  wheelchairAccessible?: boolean;
}

export class SetAddressDto {
  @IsNumber()
  lat: number;

  @IsNumber()
  lng: number;

  @IsString()
  address: string;
}

export class CreateFavouritePlaceDto {
  @IsOptional()
  @IsEnum(FavouritePlaceType)
  type?: FavouritePlaceType;

  @IsString()
  label: string;

  @IsNumber()
  lat: number;

  @IsNumber()
  lng: number;

  @IsString()
  address: string;
}

export class CreateEmergencyContactDto {
  @IsString()
  name: string;

  @IsString()
  phone: string;

  @IsOptional()
  @IsString()
  relationship?: string;
}

export class BlacklistPassengerDto {
  @IsBoolean()
  blacklisted: boolean;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class SubmitVerificationDto {
  @IsOptional()
  @IsString()
  idDocumentUrl?: string;
}
