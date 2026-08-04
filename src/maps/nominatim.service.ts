import { Injectable, Logger } from '@nestjs/common';
import { GeocodeResult } from './google-maps.service';

/**
 * OpenStreetMap's Nominatim geocoder — genuinely free, no API key or
 * billing account required, which makes it the practical "just get
 * address search working today" option compared to Google Maps (needs a
 * billing-enabled GCP project) or any other paid provider.
 *
 * IMPORTANT — Nominatim's usage policy (https://operations.osmfoundation.org/policies/nominatim/)
 * for the free public instance used here:
 *   - Requires a real, identifying User-Agent (set below) — requests
 *     without one get rejected, this isn't optional.
 *   - Max ~1 request/second. Fine for development and modest traffic;
 *     NOT meant for high-volume production use. If Ryda's real address-
 *     search volume grows, either self-host Nominatim or switch to a
 *     paid provider (Google Maps, Mapbox, LocationIQ) — this fallback
 *     exists to unblock development now, not as the permanent answer.
 *   - No caching/heavy scripted bulk use of the public instance.
 *
 * Untested live in the environment this was written in — this sandbox's
 * network policy blocks nominatim.openstreetmap.org (confirmed: the
 * block is from this sandbox's own egress proxy, not Nominatim itself
 * rejecting the request). Built carefully against Nominatim's
 * documented, long-stable API shape; verify it works once deployed
 * somewhere with normal internet access.
 */
@Injectable()
export class NominatimService {
  private readonly logger = new Logger(NominatimService.name);
  private readonly baseUrl = 'https://nominatim.openstreetmap.org';
  private readonly userAgent = 'RydaBackend/1.0 (ride-hailing platform; contact: support@ryda.example.com)';

  async geocode(address: string): Promise<GeocodeResult | null> {
    try {
      const url = `${this.baseUrl}/search?q=${encodeURIComponent(address)}&format=json&limit=1`;
      const response = await fetch(url, { headers: { 'User-Agent': this.userAgent }, signal: AbortSignal.timeout(5000) });
      if (!response.ok) {
        this.logger.warn(`Nominatim geocode HTTP ${response.status} for "${address}"`);
        return null;
      }
      const results = (await response.json()) as Array<{ lat: string; lon: string; display_name: string }>;
      if (!results.length) return null;

      return {
        lat: parseFloat(results[0].lat),
        lng: parseFloat(results[0].lon),
        formattedAddress: results[0].display_name,
      };
    } catch (err) {
      this.logger.error('Nominatim geocode request failed', err as Error);
      return null;
    }
  }

  /**
   * Same underlying Nominatim /search endpoint as geocode(), but returns
   * every ranked result up to `limit` instead of just the top one — what
   * an autocomplete-as-you-type dropdown actually needs. A short query
   * (a couple characters) can return noisy/irrelevant results since
   * Nominatim isn't purpose-built for prefix autocomplete the way Google
   * Places Autocomplete is; the app-side debounce (only searching after
   * a pause in typing, and only once there's a few characters) is what
   * keeps this usable in practice.
   */
  async suggest(query: string, limit = 5): Promise<GeocodeResult[]> {
    try {
      const url = `${this.baseUrl}/search?q=${encodeURIComponent(query)}&format=json&limit=${limit}`;
      const response = await fetch(url, { headers: { 'User-Agent': this.userAgent }, signal: AbortSignal.timeout(5000) });
      if (!response.ok) {
        this.logger.warn(`Nominatim suggest HTTP ${response.status} for "${query}"`);
        return [];
      }
      const results = (await response.json()) as Array<{ lat: string; lon: string; display_name: string }>;
      return results.map((r) => ({
        lat: parseFloat(r.lat),
        lng: parseFloat(r.lon),
        formattedAddress: r.display_name,
      }));
    } catch (err) {
      this.logger.error('Nominatim suggest request failed', err as Error);
      return [];
    }
  }

  async reverseGeocode(lat: number, lng: number): Promise<GeocodeResult | null> {
    try {
      const url = `${this.baseUrl}/reverse?lat=${lat}&lon=${lng}&format=json`;
      const response = await fetch(url, { headers: { 'User-Agent': this.userAgent }, signal: AbortSignal.timeout(5000) });
      if (!response.ok) {
        this.logger.warn(`Nominatim reverse geocode HTTP ${response.status} for ${lat},${lng}`);
        return null;
      }
      const result = (await response.json()) as { lat: string; lon: string; display_name: string; error?: string };
      if (result.error) return null;

      return {
        lat: parseFloat(result.lat),
        lng: parseFloat(result.lon),
        formattedAddress: result.display_name,
      };
    } catch (err) {
      this.logger.error('Nominatim reverse geocode request failed', err as Error);
      return null;
    }
  }
}
