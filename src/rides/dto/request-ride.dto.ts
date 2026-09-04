import { IsBoolean, IsDateString, IsEnum, IsNumber, IsOptional, IsString, ValidateNested, ArrayMaxSize } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { RideCategory, PaymentMethod } from '../../common/enums/ride.enum';
import { DispatchMode } from '../../candidate-search/candidate-search.types';

export class RideStopDto {
  @IsNumber()
  lat: number;

  @IsNumber()
  lng: number;

  @IsString()
  address: string;
}

export class RequestRideDto {
  @IsEnum(RideCategory)
  category: RideCategory;

  @IsNumber()
  pickupLat: number;

  @IsNumber()
  pickupLng: number;

  @IsString()
  pickupAddress: string;

  // Nearest Google entrance/access-point to pickupLat/Lng, resolved
  // client-side via GET /maps/place-details?includeEntrances=true
  // when the passenger confirmed a place (not a bare map pin - see
  // GoogleMapsService.nearestAccessPoint()). Optional: most pickups
  // won't have entrance data, and a plain dropped pin never will.
  @IsOptional()
  @IsNumber()
  pickupEntranceLat?: number;

  @IsOptional()
  @IsNumber()
  pickupEntranceLng?: number;

  // Resolved client-side via GET /airports/detect and, if the
  // passenger picked a specific terminal/zone, GET /airports/:id/zones
  // - see RidesService.requestRide() for the eligibility check and
  // zone-name resolution this triggers. Neither is required: most
  // rides aren't airport pickups at all.
  @IsOptional()
  @IsString()
  pickupAirportId?: string;

  @IsOptional()
  @IsString()
  pickupZoneId?: string;

  @IsNumber()
  dropoffLat: number;

  @IsNumber()
  dropoffLng: number;

  @IsString()
  dropoffAddress: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;

  @IsOptional()
  @IsString()
  promoCode?: string;

  @IsOptional()
  @IsBoolean()
  isAirportTrip?: boolean;

  @IsOptional()
  @IsString()
  flightNumber?: string;

  @ApiPropertyOptional({ description: 'ISO datetime — books this ride for a future pickup instead of dispatching immediately' })
  @IsOptional()
  @IsDateString()
  scheduledAt?: string;

  @ApiPropertyOptional({
    enum: DispatchMode,
    description:
      'MANUAL (default): ride stays "searching" until the passenger picks a driver from GET /rides/:id/selectable-drivers. ' +
      'AUTO: the system automatically offers the ride to the best-ranked eligible driver, moving to the next one on decline/timeout.',
  })
  @IsOptional()
  @IsEnum(DispatchMode)
  dispatchMode?: DispatchMode;

  // Pickup → stop 1 → stop 2 → ... → dropoff, in visit order. Capped
  // at 3 - a genuinely long waypoint chain starts looking like a
  // different product (a delivery route, not a ride), and each extra
  // stop is another real-routing API call on top of the base
  // pickup→dropoff one.
  @ApiPropertyOptional({ type: [RideStopDto], description: 'Intermediate stops in visit order, between pickup and dropoff' })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => RideStopDto)
  @ArrayMaxSize(3)
  stops?: RideStopDto[];

  // Opt into shared-ride matching (see PoolMatchingService) instead of
  // a normal solo dispatch. Silently ignored (treated as a normal solo
  // request) if the ride_sharing feature flag is off - a passenger who
  // checks "share my ride" shouldn't get an error just because the
  // feature is disabled platform-wide, they should just get a normal
  // ride at the normal (undiscounted) fare.
  @ApiPropertyOptional({ description: 'Opt into shared/pooled ride matching' })
  @IsOptional()
  @IsBoolean()
  isPooled?: boolean;
}
