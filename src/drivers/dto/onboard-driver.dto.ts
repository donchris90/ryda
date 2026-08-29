import { ArrayMinSize, ArrayUnique, IsArray, IsEnum, IsOptional, IsString } from 'class-validator';
import { DriverService } from '../../common/enums/driver-service.enum';

export class OnboardDriverDto {
  @IsString()
  licenseNumber: string;

  @IsOptional()
  @IsString()
  city?: string;

  /**
   * Which services the driver wants to be considered for — "Rides",
   * "Deliveries", or both. This is a request, not an approval: it
   * creates PENDING DriverServiceCapability rows (see
   * DriversService.requestServices()). Zero services is rejected here
   * server-side, same as the app's UI already prevents it — the
   * frontend check alone is not trustworthy.
   */
  @IsArray()
  @ArrayMinSize(1, { message: 'Select at least one service (Rides and/or Deliveries).' })
  @ArrayUnique()
  @IsEnum(DriverService, { each: true })
  services: DriverService[];
}
