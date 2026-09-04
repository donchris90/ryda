import {
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Min,
} from 'class-validator';
import {
  DeliveryCategory,
  DeliveryVehicleType,
  DeliveryDispatchMode,
} from '../entities/delivery-order.entity';
import { PaymentMethod } from '../../common/enums/ride.enum';

export class EstimateDeliveryDto {
  @IsEnum(DeliveryCategory)
  category: DeliveryCategory;

  @IsOptional()
  @IsEnum(DeliveryVehicleType)
  vehicleType?: DeliveryVehicleType;

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

  // Defaults to AUTO in the service layer, not here, so existing
  // callers that never send this field keep today's behavior exactly.
  @IsOptional()
  @IsEnum(DeliveryDispatchMode)
  dispatchMode?: DeliveryDispatchMode;
}

export class CancelDeliveryDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

export class MarkDeliveredDto {
  // Uploaded separately via POST /storage/upload/delivery-proof - this
  // just links the resulting URL. Always required (see
  // LogisticsService.markDelivered()'s own reasoning for why).
  @IsUrl()
  photoUrl: string;

  // Only actually required when the order itself was flagged
  // requiresSignature at creation - enforced in the service layer,
  // not here, since that check depends on the order's own data.
  @IsOptional()
  @IsUrl()
  signatureUrl?: string;

  @IsOptional()
  @IsString()
  recipientName?: string;

  @IsOptional()
  @IsNumber()
  deliveryLat?: number;

  @IsOptional()
  @IsNumber()
  deliveryLng?: number;

  // Only actually required for COD orders (order.isCod) - enforced in
  // the service layer since that depends on the order's own data, same
  // reasoning as signatureUrl above.
  @IsOptional()
  @IsNumber()
  @Min(0)
  codCollectedAmount?: number;
}
