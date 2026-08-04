import { IsEnum, IsOptional, IsString } from 'class-validator';
import { FraudFlagStatus } from '../entities/fraud-flag.entity';

export class ReviewFlagDto {
  @IsEnum(FraudFlagStatus)
  status: FraudFlagStatus;

  @IsOptional()
  @IsString()
  notes?: string;
}
