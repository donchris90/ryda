import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
} from '@nestjs/common';

import {
  GoogleMapsService,
} from './google-maps.service';

import {
  GeocodeDto,
  ReverseGeocodeDto,
  RoutePreviewDto,
} from './maps.dto';
import { decodePolyline } from '../common/utils/polyline.util';

@Controller('maps')
export class MapsController {
  constructor(
    private readonly mapsService: GoogleMapsService,
  ) {}

  @Get('autocomplete')
  async autocomplete(
    @Query('query') query?: string,
    @Query('limit') limit?: string,
    @Query('lat') lat?: string,
    @Query('lng') lng?: string,
  ) {
    if (
      !query ||
      query.trim().length < 2
    ) {
      return [];
    }

    const max =
      limit
        ? parseInt(limit, 10)
        : 5;

    const latitude =
      lat !== undefined
        ? Number(lat)
        : undefined;

    const longitude =
      lng !== undefined
        ? Number(lng)
        : undefined;

    return this.mapsService.suggest(
      query,
      max,
      latitude,
      longitude,
    );
  }

  @Get('place-details')
  async placeDetails(
    @Query('placeId') placeId?: string,
  ) {
    if (!placeId?.trim()) {
      throw new BadRequestException('placeId is required');
    }

    const result = await this.mapsService.getPlaceDetailsById(placeId);

    if (!result) {
      throw new BadRequestException(
        'Could not resolve that place',
      );
    }

    return result;
  }

  @Post('geocode')
  async geocode(
    @Body() dto: GeocodeDto,
  ) {
    const result =
      await this.mapsService.geocode(
        dto.address,
      );

    if (!result) {
      throw new BadRequestException(
        'Could not resolve that Nigerian address',
      );
    }

    return result;
  }

  @Post('reverse-geocode')
  async reverseGeocode(
    @Body() dto: ReverseGeocodeDto,
  ) {
    const result =
      await this.mapsService.reverseGeocode(
        dto.lat,
        dto.lng,
      );

    if (!result) {
      throw new BadRequestException(
        'Could not resolve that Nigerian location',
      );
    }

    return result;
  }

  /**
   * Route preview for the booking screen — called once both pickup and
   * dropoff are set, before the ride is created. Same
   * GoogleMapsService.getDirections() + decodePolyline() pair
   * RidesService.getRoute() uses for an in-progress ride's map; this is
   * the pre-booking equivalent, since there's no ride id to look up
   * yet at this point in the flow.
   *
   * Returns null (not an error) when routing isn't configured/available
   * — RideMapView already falls back to a straight dashed line between
   * pickup and dropoff in that case, same as the in-ride map does.
   */
  @Post('route-preview')
  async routePreview(@Body() dto: RoutePreviewDto) {
    if (!this.mapsService.isConfigured()) return null;

    const directions = await this.mapsService.getDirections(
      { lat: dto.pickupLat, lng: dto.pickupLng },
      { lat: dto.dropoffLat, lng: dto.dropoffLng },
    );
    if (!directions?.polyline) return null;

    return { points: decodePolyline(directions.polyline) };
  }
}
