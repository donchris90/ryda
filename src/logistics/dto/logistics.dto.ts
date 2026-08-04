import {
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { DeliveryCategory } from '../entities/delivery-order.entity';
import { PaymentMethod } from '../../common/enums/ride.enum';

export class EstimateDeliveryDto {
  @IsEnum(DeliveryCategory)
  category: DeliveryCategory;

  @IsNumber()
  pickupLat: number;

  @IsNumber()
  pickupLng: number;

  @IsNumber()
  dropoffLat: number;

  @IsNumber()
  dropoffLng: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  weightKg?: number;
}

export class RequestDeliveryDto extends EstimateDeliveryDto {
  @IsString()
  pickupAddress: string;

  @IsString()
  pickupContactName: string;

  @IsString()
  pickupContactPhone: string;

  @IsString()
  dropoffAddress: string;

  @IsString()
  dropoffContactName: string;

  @IsString()
  dropoffContactPhone: string;

  @IsString()
  itemDescription: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  itemValue?: number;

  @IsOptional()
  @IsBoolean()
  requiresSignature?: boolean;

  @IsOptional()
  @IsBoolean()
  isCod?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  codAmount?: number;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;
}

export class CancelDeliveryDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
