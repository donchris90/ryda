import { IsInt, Min } from 'class-validator';

export class RedeemLoyaltyDto {
  @IsInt()
  @Min(1)
  points: number;
}
