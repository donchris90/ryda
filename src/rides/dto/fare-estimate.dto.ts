import { IsBoolean, IsEnum, IsNumber, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RideCategory } from '../../common/enums/ride.enum';

export class FareEstimateDto {
  @ApiProperty({ enum: RideCategory, example: RideCategory.ECONOMY })
  @IsEnum(RideCategory)
  category: RideCategory;

  @ApiProperty({ example: 6.6018 })
  @IsNumber()
  pickupLat: number;

  @ApiProperty({ example: 3.3515 })
  @IsNumber()
  pickupLng: number;

  @ApiProperty({ example: 6.4281 })
  @IsNumber()
  dropoffLat: number;

  @ApiProperty({ example: 3.4219 })
  @IsNumber()
  dropoffLng: number;

  @ApiPropertyOptional({ example: 'Lagos', description: 'Used for surge calculation and night/airport pricing' })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ description: 'Adds the flat airport surcharge' })
  @IsOptional()
  @IsBoolean()
  isAirportTrip?: boolean;
}
