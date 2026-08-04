import { IsBoolean, IsDateString, IsEnum, IsNumber, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { RideCategory, PaymentMethod } from '../../common/enums/ride.enum';

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
}
