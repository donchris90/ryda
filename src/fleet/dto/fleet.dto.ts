import { IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class CreateFleetCompanyDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  registrationNumber?: string;

  @IsOptional()
  @IsString()
  city?: string;
}

export class AddFleetManagerDto {
  @IsUUID()
  userId: string;
}

export class AssignDriverDto {
  @IsUUID()
  driverUserId: string;
}

export class AssignVehicleDto {
  @IsUUID()
  vehicleId: string;
}

export class RequestPayoutDto {
  @IsNumber()
  @Min(100)
  amount: number;

  @IsString()
  bankAccountNumber: string;

  @IsString()
  bankCode: string;
}
