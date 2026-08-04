import { IsEmail, IsOptional, IsPhoneNumber, IsString, ValidateIf } from 'class-validator';
import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  // Format-checked whenever provided, AND required if email is absent —
  // covers all four cases correctly: phone-only (format-checked, email
  // skipped), email-only (skipped, email format-checked), neither
  // (both fail — clear error either way), both (both format-checked,
  // not silently skipped).
  @ApiPropertyOptional({ example: '+2348011112222', description: 'Required if email is not provided' })
  @ValidateIf((o) => !!o.phone || !o.email)
  @IsPhoneNumber()
  phone?: string;

  @ApiPropertyOptional({ example: 'ada@example.com', description: 'Required if phone is not provided' })
  @ValidateIf((o) => !!o.email || !o.phone)
  @IsEmail()
  email?: string;

  @ApiProperty({ example: 'Passw0rd!' })
  @IsString()
  password: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  deviceFingerprint?: string;
}
