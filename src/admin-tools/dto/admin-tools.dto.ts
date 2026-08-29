import { IsBoolean, IsEnum, IsNumber, IsString } from 'class-validator';
import { Type } from 'class-transformer';
import { DeliveryVehicleType } from '../../logistics/entities/delivery-order.entity';

export class SetMaintenanceModeDto {
  @IsBoolean()
  enabled: boolean;
}

// PRODUCTION DIAGNOSTIC ENDPOINT — "Why is driver X not available for
// courier matching at pickup Y?" Query params rather than a body since
// this is a GET (read-only, no side effects).
export class CourierMatchDiagnosticQueryDto {
  @IsString()
  driverUserId: string;

  @Type(() => Number)
  @IsNumber()
  pickupLat: number;

  @Type(() => Number)
  @IsNumber()
  pickupLng: number;

  @IsEnum(DeliveryVehicleType)
  deliveryVehicleType: DeliveryVehicleType;
}
