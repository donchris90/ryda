import { IsEmail, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class VerifyEmailDto {
  @ApiProperty()
  @IsString()
  token: string;
}

export class ResendVerificationDto {
  @ApiProperty({ example: 'ada@example.com' })
  @IsEmail()
  email: string;
}

export class ForgotPasswordDto {
  @ApiProperty({ example: 'ada@example.com' })
  @IsEmail()
  email: string;
}

export class ResetPasswordDto {
  @ApiProperty()
  @IsString()
  token: string;

  @ApiProperty({ example: 'NewPassw0rd!', minLength: 8 })
  @IsString()
  @MinLength(8)
  newPassword: string;
}
