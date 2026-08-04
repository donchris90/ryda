import { IsEnum, IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { IncentiveType } from '../entities/incentive.entity';

export class CreateIncentiveDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsEnum(IncentiveType)
  type: IncentiveType;

  @IsOptional()
  @IsInt()
  @Min(1)
  targetTrips?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  windowHours?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  peakStartHour?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  peakEndHour?: number;

  @IsNumber()
  @Min(0)
  rewardAmount: number;
}
