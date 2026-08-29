import { IsPhoneNumber, IsString, Length } from 'class-validator';
import { Transform } from 'class-transformer';
import { normalizeNigerianPhone } from '../../common/utils/phone.util';

export class SendOtpDto {
  @Transform(({ value }) => (typeof value === 'string' ? normalizeNigerianPhone(value) : value))
  @IsPhoneNumber('NG')
  phone: string;
}

export class VerifyOtpDto {
  @Transform(({ value }) => (typeof value === 'string' ? normalizeNigerianPhone(value) : value))
  @IsPhoneNumber('NG')
  phone: string;

  @IsString()
  @Length(4, 8)
  code: string;
}
