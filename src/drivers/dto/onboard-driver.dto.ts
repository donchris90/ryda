import { IsOptional, IsString } from 'class-validator';

export class OnboardDriverDto {
  @IsString()
  licenseNumber: string;

  @IsOptional()
  @IsString()
  city?: string;
}
