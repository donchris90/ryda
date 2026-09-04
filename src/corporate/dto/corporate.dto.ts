import { IsArray, IsEnum, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { RideCategory } from '../../common/enums/ride.enum';

export class CreateCorporateAccountDto {
  @IsString()
  companyName: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  initialBudget?: number;
}

export class AddEmployeeDto {
  @IsUUID()
  userId: string;
}

export class TopUpBudgetDto {
  @IsNumber()
  @Min(0.01)
  amount: number;
}

export class UpdateCorporatePolicyDto {
  // Sending an empty array means "no categories allowed" (a real,
  // if unusual, policy); omitting the field entirely leaves whatever
  // was already configured untouched - see CorporateService.
  // updatePolicy()'s own per-field-undefined-check for why those two
  // are handled differently.
  @IsOptional()
  @IsArray()
  @IsEnum(RideCategory, { each: true })
  allowedCategories?: RideCategory[];

  @IsOptional()
  @IsNumber()
  @Min(0)
  maxFarePerRide?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(23)
  operatingHoursStart?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(23)
  operatingHoursEnd?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedCities?: string[];
}

export class UpdateEmployeeDto {
  @IsOptional()
  @IsString()
  department?: string | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  monthlySpendLimit?: number | null;
}

export class ReviewApprovalDto {
  @IsEnum(['approved', 'rejected'])
  status: 'approved' | 'rejected';

  @IsOptional()
  @IsString()
  notes?: string;
}
