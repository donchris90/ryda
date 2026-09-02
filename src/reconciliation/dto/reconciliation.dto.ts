import { IsString } from 'class-validator';

export class WriteOffDto {
  @IsString()
  reason: string;
}

export class ResolveDiscrepancyDto {
  @IsString()
  note: string;
}
