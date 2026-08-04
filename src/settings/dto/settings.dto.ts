import { IsOptional, IsString } from 'class-validator';

export class UpsertSettingDto {
  @IsString()
  value: string;

  @IsOptional()
  @IsString()
  description?: string;
}
