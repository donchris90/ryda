import { IsString } from 'class-validator';

export class SelectCourierDto {
  @IsString()
  driverUserId: string;
}
