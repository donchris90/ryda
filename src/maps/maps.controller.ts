import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
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
@UseGuards(JwtAuthGuard)
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
    // Opt-in: pulls Google's per-entrance door coordinates, not just
    // the place's centroid. Costs more (Enterprise-SKU Place Details),
    // so the frontend should only pass this when confirming an actual
    // pickup point, not for every place lookup (e.g. dropoff, saved
    // favourites where the exact door doesn't matter).
    @Query('includeEntrances') includeEntrances?: string,
  ) {
    if (!placeId?.trim()) {
      throw new BadRequestException('placeId is required');
    }

    const result = await this.mapsService.getPlaceDetailsById(
      placeId,
      includeEntrances === 'true',
    );

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

  /**
   * Pickup intelligence: nearest-road snapping. Useful when a GPS fix
   * or a map tap lands inside a building/compound rather than on the
   * actual road a driver needs to stop on. Returns the original point
   * unchanged (wasSnapped: false) rather than an error when snapping
   * isn't available or the point is already road-adjacent - the app
   * can use wasSnapped to decide whether it's worth prompting the
   * passenger about the adjustment at all.
   */
  @Post('snap-to-road')
  async snapToRoad(@Body() dto: ReverseGeocodeDto) {
    const result = await this.mapsService.snapToRoad(dto.lat, dto.lng);
    if (!result) {
      return { lat: dto.lat, lng: dto.lng, wasSnapped: false };
    }
    return result;
  }
}
