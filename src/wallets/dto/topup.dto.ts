import { IsNumber, Min } from 'class-validator';

export class TopUpDto {
  @IsNumber()
  @Min(1)
  amount: number;
}
