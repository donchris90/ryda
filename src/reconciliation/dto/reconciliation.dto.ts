import { IsString } from 'class-validator';

export class WriteOffDto {
  @IsString()
  reason: string;
}
