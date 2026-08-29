import { ArrayMinSize, IsArray, IsNumber, IsOptional, IsPhoneNumber, Min } from 'class-validator';
import { Transform } from 'class-transformer';
import { normalizeNigerianPhone } from '../../common/utils/phone.util';

export class CreateSplitFareDto {
  @IsArray()
  @ArrayMinSize(1)
  @Transform(({ value }) =>
    Array.isArray(value) ? value.map((v) => (typeof v === 'string' ? normalizeNigerianPhone(v) : v)) : value,
  )
  @IsPhoneNumber('NG', { each: true })
  participantPhones: string[];

  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  @Min(0, { each: true })
  amounts?: number[];
}
