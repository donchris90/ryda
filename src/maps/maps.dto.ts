import { IsLatitude, IsLongitude, IsNumber, IsString } from 'class-validator';

export class GeocodeDto {
  @IsString()
  address: string;
}

export class ReverseGeocodeDto {
  @IsNumber()
  lat: number;

  @IsNumber()
  lng: number;
}

/**
 * For the passenger booking flow's route preview — drawn on the map
 * once both pickup and dropoff are set, before a ride exists. Distinct
 * from RidesController's GET :id/route (which needs an existing ride
 * to look up), since there's nothing to look up yet at booking time.
 */
export class RoutePreviewDto {
  @IsLatitude()
  pickupLat: number;

  @IsLongitude()
  pickupLng: number;

  @IsLatitude()
  dropoffLat: number;

  @IsLongitude()
  dropoffLng: number;
}

