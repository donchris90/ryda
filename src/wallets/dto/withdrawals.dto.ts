import { IsNumber, IsString, Min } from 'class-validator';

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
