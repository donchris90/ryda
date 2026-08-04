import { IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

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
