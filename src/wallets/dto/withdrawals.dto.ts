import { IsNumber, IsString, IsUUID, Length, Min } from 'class-validator';

export class AddBankAccountDto {
  @IsString()
  bankCode: string;

  @IsString()
  bankName: string;

  @IsString()
  accountNumber: string;
}

export class RequestWithdrawalDto {
  @IsString()
  bankAccountId: string;

  @IsNumber()
  @Min(0.01)
  amount: number;
}

export class ConfirmWithdrawalDto {
  @IsUUID()
  withdrawalRequestId: string;

  @IsString()
  @Length(4, 8)
  otpCode: string;
}
