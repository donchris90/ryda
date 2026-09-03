import { IsNumber, IsOptional, Max, Min } from 'class-validator';

export class UpdateLocationDto {
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  lng: number;

  /** GPS accuracy radius in meters, as reported by the device (e.g. expo-location's Location.Accuracy). Optional so older app builds that don't send it yet keep working. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  accuracy?: number;

  /** Unix ms timestamp of when the device actually took this GPS fix (not when it was uploaded) - lets the server detect a stale reading queued/retried after a connectivity gap. Optional for the same reason as accuracy. */
  @IsOptional()
  @IsNumber()
  fixTimestamp?: number;
}
