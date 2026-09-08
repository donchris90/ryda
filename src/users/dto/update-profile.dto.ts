import { IsEmail, IsOptional, IsString, Matches } from 'class-validator';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  // Same loose pattern as other phone fields in this codebase (no
  // strict E.164 enforcement here, just a sanity check) - the actual
  // canonical-format normalization already happens client-side via
  // normalizeNigerianPhone() before this ever reaches the network.
  @IsOptional()
  @Matches(/^\+?[0-9]{7,15}$/, { message: 'Enter a valid phone number' })
  phone?: string;
}
