import { IsEmail, IsNumber, IsOptional, IsString, Length, Min } from 'class-validator';

export class AdminCreditWalletDto {
  @IsEmail()
  email: string;

  @IsNumber()
  @Min(1)
  amount: number;

  @IsOptional()
  @IsString()
  @Length(0, 200)
  reason?: string;
}
