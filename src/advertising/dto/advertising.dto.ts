import { IsDateString, IsEnum, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { BannerPlacement } from '../entities/banner-ad.entity';

export class CreateCampaignDto {
  @IsString()
  name: string;

  @IsString()
  advertiserName: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  budget?: number;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}

export class CreateBannerAdDto {
  @IsOptional()
  @IsString()
  campaignId?: string;

  @IsString()
  title: string;

  @IsString()
  imageUrl: string;

  @IsString()
  targetUrl: string;

  @IsEnum(BannerPlacement)
  placement: BannerPlacement;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}

export class CreateSponsoredLocationDto {
  @IsOptional()
  @IsString()
  campaignId?: string;

  @IsString()
  name: string;

  @IsNumber()
  lat: number;

  @IsNumber()
  lng: number;

  @IsOptional()
  @IsNumber()
  @Min(0.1)
  radiusKm?: number;

  @IsOptional()
  @IsString()
  iconUrl?: string;

  @IsOptional()
  @IsString()
  targetUrl?: string;
}
