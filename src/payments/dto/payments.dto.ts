import { IsNumber, IsOptional, Min } from 'class-validator';

export class SetDefaultCardDto {}

export class RefundPaymentDto {
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  amount?: number;
}
