import { IsEmail, IsNumber, IsOptional, IsPhoneNumber, IsString, IsUUID, Length, Min, ValidateIf } from 'class-validator';

// Accepts EITHER recipientPhone or recipientEmail, not both required -
// the old app build (still installed on some devices) sends phone,
// the current build sends email. Backend supports both so a person
// isn't blocked from transferring money while waiting on an app
// rebuild. At least one must be present; the service prefers email
// when both are given, since that's the current standard identifier.
export class InitiateTransferDto {
  @ValidateIf((o) => !o.recipientEmail)
  @IsPhoneNumber()
  recipientPhone?: string;

  @ValidateIf((o) => !o.recipientPhone)
  @IsEmail()
  recipientEmail?: string;

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
