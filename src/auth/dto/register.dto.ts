import {
  Equals,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsPhoneNumber,
  IsString,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole } from '../../common/enums/user-role.enum';
import { normalizeNigerianPhone } from '../../common/utils/phone.util';

export class RegisterDto {
  @ApiProperty({ example: 'ada@example.com' })
  @IsEmail()
  email: string;

  @ApiPropertyOptional({
    example: '08011112222',
    description:
      'Optional — used for ride communication and emergency contact, not for account verification. ' +
      'Local Nigerian format (e.g. 08011112222) works fine; +234 is not required.',
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? normalizeNigerianPhone(value) : value))
  @IsPhoneNumber('NG')
  phone?: string;

  @ApiProperty({ example: 'Passw0rd!', minLength: 8 })
  @IsString()
  @MinLength(8)
  password: string;

  @ApiProperty({ example: 'Ada' })
  @IsString()
  firstName: string;

  @ApiProperty({ example: 'Obi' })
  @IsString()
  lastName: string;

  // Confirm-password matching is a form-level UX check on the client,
  // not something meaningfully re-validated server-side once we
  // already have the single, final password value here.
  @ApiProperty({ example: true, description: 'Must be true — registration requires accepting the Terms & Conditions.' })
  @IsBoolean()
  @Equals(true, { message: 'You must accept the Terms & Conditions to register' })
  termsAccepted: boolean;

  @ApiPropertyOptional({ enum: UserRole, default: UserRole.PASSENGER })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @ApiPropertyOptional({ description: "Another user's referral code, if any" })
  @IsOptional()
  @IsString()
  referralCode?: string;

  @ApiPropertyOptional({ description: 'Client-generated device identifier, used for fraud detection' })
  @IsOptional()
  @IsString()
  deviceFingerprint?: string;
}
