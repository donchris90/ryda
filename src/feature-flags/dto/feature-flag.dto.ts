import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class UpsertFeatureFlagDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsBoolean()
  isEnabled: boolean;
}
