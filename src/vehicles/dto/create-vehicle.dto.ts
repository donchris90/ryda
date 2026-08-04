import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { VehicleCategory } from '../../common/enums/vehicle.enum';

export class CreateVehicleDto {
  @IsEnum(VehicleCategory)
  category: VehicleCategory;

  @IsString()
  make: string;

  @IsString()
  model: string;

  @IsInt()
  @Min(1990)
  @Max(new Date().getFullYear() + 1)
  year: number;

  @IsOptional()
  @IsString()
  color?: string;

  @IsString()
  plateNumber: string;

  @IsOptional()
  @IsString()
  vin?: string;
}
