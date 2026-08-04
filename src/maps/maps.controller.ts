import { BadRequestException, Body, Controller, Get, Post, Query } from '@nestjs/common';
import { GoogleMapsService } from './google-maps.service';
import { NominatimService } from './nominatim.service';
import { GeocodeDto, ReverseGeocodeDto } from './maps.dto';

@Controller('maps')
export class MapsController {
  constructor(
    private readonly mapsService: GoogleMapsService,
    private readonly nominatimService: NominatimService,
  ) {}

  @Get('autocomplete')
  async autocomplete(@Query('query') query?: string, @Query('limit') limit?: string) {
    if (!query || query.trim().length < 3) return [];
    const max = limit ? parseInt(limit, 10) : 5;

    if (this.mapsService.isConfigured()) {
      const results = await this.mapsService.suggest(query, max);
      if (results.length) return results;
    }
    return this.nominatimService.suggest(query, max);
  }

  @Post('geocode')
  async geocode(@Body() dto: GeocodeDto) {
    // Google first if it's actually configured (better accuracy, real
    // billing account) — Nominatim (free, no key needed) as the fallback
    // so address search works out of the box without any setup.
    if (this.mapsService.isConfigured()) {
      const result = await this.mapsService.geocode(dto.address);
      if (result) return result;
    }
    const fallback = await this.nominatimService.geocode(dto.address);
    if (!fallback) throw new BadRequestException('Could not resolve that address');
    return fallback;
  }

  @Post('reverse-geocode')
  async reverseGeocode(@Body() dto: ReverseGeocodeDto) {
    if (this.mapsService.isConfigured()) {
      const result = await this.mapsService.reverseGeocode(dto.lat, dto.lng);
      if (result) return result;
    }
    const fallback = await this.nominatimService.reverseGeocode(dto.lat, dto.lng);
    if (!fallback) throw new BadRequestException('Could not resolve that location');
    return fallback;
  }
}
