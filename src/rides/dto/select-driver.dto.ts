import { IsString } from 'class-validator';

export class SelectDriverDto {
  @IsString()
  driverUserId: string;
}
