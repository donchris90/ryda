import { IsNumber, IsString, Length, Min } from 'class-validator';

export class AddTipDto {
  @IsNumber()
  @Min(1)
  amount: number;
}

export class VerifyPinDto {
  @IsString()
  @Length(4, 4)
  pin: string;
}
