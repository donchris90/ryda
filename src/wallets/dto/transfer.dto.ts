import { IsEmail, IsNumber, IsOptional, IsString, IsUUID, Length, Min } from 'class-validator';

export class InitiateTransferDto {
  @IsEmail()
  recipientEmail: string;

  @IsNumber()
  @Min(1)
  amount: number;

  @IsOptional()
  @IsString()
  @Length(0, 200)
  note?: string;
}

export class ConfirmTransferDto {
  @IsUUID()
  transferRequestId: string;

  @IsString()
  @Length(4, 8)
  otpCode: string;
}
