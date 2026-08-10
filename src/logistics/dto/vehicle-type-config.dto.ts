import { IsBoolean, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class UpsertVehicleTypeConfigDto {
  @IsNumber()
  @Min(0)
  baseFare: number;

  @IsNumber()
  @Min(0)
  perKm: number;

  @IsNumber()
  @Min(0)
  perKg: number;

  @IsNumber()
  @Min(0)
  minimumFare: number;

  @IsNumber()
  @Min(0.1)
  maxWeightKg: number;

  @IsOptional()
  @IsString()
  capacityDescription?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
