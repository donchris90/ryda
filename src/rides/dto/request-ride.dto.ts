import { IsBoolean, IsDateString, IsEnum, IsNumber, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { RideCategory, PaymentMethod } from '../../common/enums/ride.enum';
import { DispatchMode } from '../../candidate-search/candidate-search.types';

export class RequestRideDto {
  @IsEnum(RideCategory)
  category: RideCategory;

  @IsNumber()
  pickupLat: number;

  @IsNumber()
  pickupLng: number;

  @IsString()
  pickupAddress: string;

  @IsNumber()
  dropoffLat: number;

  @IsNumber()
  dropoffLng: number;

  @IsString()
  dropoffAddress: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;

  @IsOptional()
  @IsString()
  promoCode?: string;

  @IsOptional()
  @IsBoolean()
  isAirportTrip?: boolean;

  @IsOptional()
  @IsString()
  flightNumber?: string;

  @ApiPropertyOptional({ description: 'ISO datetime — books this ride for a future pickup instead of dispatching immediately' })
  @IsOptional()
  @IsDateString()
  scheduledAt?: string;

  @ApiPropertyOptional({
    enum: DispatchMode,
    description:
      'MANUAL (default): ride stays "searching" until the passenger picks a driver from GET /rides/:id/selectable-drivers. ' +
      'AUTO: the system automatically offers the ride to the best-ranked eligible driver, moving to the next one on decline/timeout.',
  })
  @IsOptional()
  @IsEnum(DispatchMode)
  dispatchMode?: DispatchMode;
}
