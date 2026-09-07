import { IsArray, IsDateString, IsOptional, IsString } from 'class-validator';

export class CreateApiKeyDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  scopes?: string[];

  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
