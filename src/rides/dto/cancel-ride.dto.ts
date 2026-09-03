import { IsOptional, IsString } from 'class-validator';

export class CancelRideDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

/**
 * Same shape as CancelRideDto, but reason is required - an admin
 * overriding a ride via the admin-only cancel endpoint should always
 * leave a record of why, since (unlike a passenger/driver cancelling
 * their own ride) there's no other obvious explanation for it.
 */
export class AdminCancelRideDto {
  @IsString()
  reason: string;
}
