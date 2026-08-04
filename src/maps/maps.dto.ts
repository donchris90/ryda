import { IsNumber, IsString } from 'class-validator';

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
