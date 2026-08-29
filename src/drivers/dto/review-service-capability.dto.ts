import { IsOptional, IsString } from 'class-validator';

export class ReviewServiceCapabilityDto {
  @IsOptional()
  @IsString()
  rejectionReason?: string;
}
