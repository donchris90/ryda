import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface GeocodeResult {
  lat: number;
  lng: number;
  formattedAddress: string;
}

export interface DirectionsResult {
  distanceKm: number;
  durationMin: number;
  polyline: string | null;
}

/**
 * Thin client over Google Maps' Geocoding and Directions APIs. Used to
 * upgrade FareService from a Haversine estimate to real road distance/
 * duration, and to resolve addresses passengers type into coordinates.
 *
 * Falls back gracefully everywhere it's called from — see
 * FareService.estimate(), which only calls this when isConfigured() is
 * true and silently keeps using Haversine otherwise.
 */
@Injectable()
export class GoogleMapsService {
  private readonly logger = new Logger(GoogleMapsService.name);
  private readonly apiKey: string;
  private readonly baseUrl = 'https://maps.googleapis.com/maps/api';

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.get<string>('googleMaps.apiKey') ?? '';
  }

  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  async geocode(address: string): Promise<GeocodeResult | null> {
    if (!this.isConfigured()) return null;

    try {
      const url = `${this.baseUrl}/geocode/json?address=${encodeURIComponent(address)}&key=${this.apiKey}`;
      const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
      const json = await response.json();

      if (json.status !== 'OK' || !json.results?.length) {
        this.logger.warn(`Geocode failed for "${address}": ${json.status}`);
        return null;
      }

      const result = json.results[0];
      return {
        lat: result.geometry.location.lat,
        lng: result.geometry.location.lng,
        formattedAddress: result.formatted_address,
      };
    } catch (err) {
      this.logger.error('Geocode request failed', err as Error);
      return null;
    }
  }

  /** Same endpoint as geocode(), returning every result up to `limit` instead of just the first — see NominatimService.suggest() for the rationale. */
  async suggest(query: string, limit = 5): Promise<GeocodeResult[]> {
    if (!this.isConfigured()) return [];
    try {
      const url = `${this.baseUrl}/geocode/json?address=${encodeURIComponent(query)}&key=${this.apiKey}`;
      const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
      const json = await response.json();
      if (json.status !== 'OK' || !json.results?.length) return [];

      return json.results.slice(0, limit).map((result: any) => ({
        lat: result.geometry.location.lat,
        lng: result.geometry.location.lng,
        formattedAddress: result.formatted_address,
      }));
    } catch (err) {
      this.logger.error('Suggest request failed', err as Error);
      return [];
    }
  }

  async reverseGeocode(lat: number, lng: number): Promise<GeocodeResult | null> {
    if (!this.isConfigured()) return null;

    try {
      const url = `${this.baseUrl}/geocode/json?latlng=${lat},${lng}&key=${this.apiKey}`;
      const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
      const json = await response.json();

      if (json.status !== 'OK' || !json.results?.length) {
        this.logger.warn(`Reverse geocode failed for ${lat},${lng}: ${json.status}`);
        return null;
      }

      const result = json.results[0];
      return {
        lat: result.geometry.location.lat,
        lng: result.geometry.location.lng,
        formattedAddress: result.formatted_address,
      };
    } catch (err) {
      this.logger.error('Reverse geocode request failed', err as Error);
      return null;
    }
  }

  /** Real road distance/duration — swaps in for FareService's Haversine estimate when configured. */
  async getDirections(
    origin: { lat: number; lng: number },
    destination: { lat: number; lng: number },
  ): Promise<DirectionsResult | null> {
    if (!this.isConfigured()) return null;

    try {
      const url =
        `${this.baseUrl}/directions/json?origin=${origin.lat},${origin.lng}` +
        `&destination=${destination.lat},${destination.lng}&key=${this.apiKey}`;
      const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
      const json = await response.json();

      if (json.status !== 'OK' || !json.routes?.length) {
        this.logger.warn(`Directions failed: ${json.status}`);
        return null;
      }

      const leg = json.routes[0].legs[0];
      return {
        distanceKm: leg.distance.value / 1000,
        durationMin: Math.ceil(leg.duration.value / 60),
        polyline: json.routes[0].overview_polyline?.points ?? null,
      };
    } catch (err) {
      this.logger.error('Directions request failed', err as Error);
      return null;
    }
  }
}
