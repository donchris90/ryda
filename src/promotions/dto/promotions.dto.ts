import { IsDateString, IsEnum, IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { PromotionType } from '../entities/promotion.entity';

export class CreatePromotionDto {
  @IsString()
  code: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsEnum(PromotionType)
  type: PromotionType;

  @IsNumber()
  @Min(0)
  value: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  maxDiscountAmount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  minFareAmount?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  usageLimitTotal?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  usageLimitPerUser?: number;

  @IsOptional()
  @IsDateString()
  validFrom?: string;

  @IsOptional()
  @IsDateString()
  validUntil?: string;

  @IsOptional()
  @IsString()
  campaignId?: string;
}

// code/type/campaignId deliberately excluded from what's editable - a
// coupon's code and discount type are part of what customers already
// redeemed against and shouldn't silently change under them, and
// reassigning campaignId isn't something this dashboard's edit form
// exposes (matches admin-dashboard's UpdatePromotionInput exactly:
// Omit<CreatePromotionInput, 'code' | 'type' | 'campaignId'>).
export class UpdatePromotionDto {
  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  value?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  maxDiscountAmount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  minFareAmount?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  usageLimitTotal?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  usageLimitPerUser?: number;

  @IsOptional()
  @IsDateString()
  validFrom?: string;

  @IsOptional()
  @IsDateString()
  validUntil?: string;
}

export class ValidatePromoDto {
  @IsString()
  code: string;

  @IsNumber()
  @Min(0)
  fareAmount: number;
}

export class CreateCampaignDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}
