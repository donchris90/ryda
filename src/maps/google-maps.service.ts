import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface GeocodeResult {
  lat: number;
  lng: number;
  formattedAddress: string;
}

export interface PlaceSuggestion {
  placeId: string;
  description: string;
}

export interface DirectionsResult {
  distanceKm: number;
  durationMin: number;
  polyline: string | null;
}

/**
 * One origin's result from getDistanceMatrix(). Unlike getDirections(),
 * a Distance Matrix call can partially fail — Google gives each
 * origin/destination pair its own status, so one unroutable driver
 * (e.g. stuck on an unmapped road) doesn't invalidate the other 7 in
 * the same batch. null means "no route for this specific origin",
 * mirroring getDirections()'s null-on-failure contract per element.
 */
export type DistanceMatrixElement = {
  distanceKm: number;
  durationMin: number;
} | null;

@Injectable()
export class GoogleMapsService {
  private readonly logger = new Logger(GoogleMapsService.name);

  private readonly apiKey: string;

  private readonly mapsBaseUrl =
    'https://maps.googleapis.com/maps/api';

  private readonly placesBaseUrl =
    'https://places.googleapis.com/v1';

  constructor(
    private readonly config: ConfigService,
  ) {
    this.apiKey =
      this.config
        .get<string>('googleMaps.apiKey')
        ?.trim() ?? '';
  }

  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  private isValidCoordinate(
    lat: number,
    lng: number,
  ): boolean {
    return (
      Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      lat >= -90 &&
      lat <= 90 &&
      lng >= -180 &&
      lng <= 180
    );
  }

  /**
   * Broad Nigeria coordinate check.
   *
   * This is only used to determine whether GPS can be used
   * as a location bias and to prevent obviously foreign
   * coordinates from being used by Ryda.
   *
   * There is NO Lagos fallback.
   */
  private isPlausibleNigeriaCoordinate(
    lat: number,
    lng: number,
  ): boolean {
    return (
      this.isValidCoordinate(lat, lng) &&
      lat >= 4 &&
      lat <= 14 &&
      lng >= 2 &&
      lng <= 15
    );
  }

  /**
   * Validate Google legacy Geocoding API result.
   */
  private isNigeria(result: any): boolean {
    const components =
      result?.address_components ??
      result?.addressComponents ??
      [];

    if (!Array.isArray(components)) {
      return false;
    }

    const country = components.find(
      (component: any) =>
        Array.isArray(component?.types) &&
        component.types.includes('country'),
    );

    if (
      country?.short_name === 'NG' ||
      country?.shortText === 'NG'
    ) {
      return true;
    }

    return false;
  }

  /**
   * ============================================================
   * AUTOCOMPLETE
   * ============================================================
   *
   * Google Places API (New).
   *
   * Nigeria-wide.
   *
   * IMPORTANT:
   *
   * - No Lagos fallback.
   * - No Abuja fallback.
   * - No fixed coordinates.
   * - If GPS is supplied and is Nigerian, it is used as a bias.
   * - If GPS is missing, Google performs the search without a
   *   location bias.
   * - Results are restricted to Nigeria.
   */
  async suggest(
    query: string,
    limit = 5,
    lat?: number,
    lng?: number,
  ): Promise<PlaceSuggestion[]> {
    if (
      !this.isConfigured() ||
      !query?.trim()
    ) {
      return [];
    }

    const resultLimit = Math.min(
      Math.max(
        Number.isFinite(limit)
          ? Math.floor(limit)
          : 5,
        1,
      ),
      5,
    );

    try {
      /**
       * Google Places API (New) request body.
       */
      const body: Record<string, any> = {
        input: query.trim(),

        /**
         * HARD COUNTRY RESTRICTION.
         *
         * Nigeria only.
         */
        includedRegionCodes: ['ng'],

        /**
         * Response language.
         */
        languageCode: 'en',
      };

      /**
       * Use the user's actual GPS position when supplied.
       *
       * There is deliberately NO fallback coordinate.
       */
      if (
        typeof lat === 'number' &&
        typeof lng === 'number' &&
        this.isPlausibleNigeriaCoordinate(
          lat,
          lng,
        )
      ) {
        body.locationBias = {
          circle: {
            center: {
              latitude: lat,
              longitude: lng,
            },
            radius: 50000,
          },
        };

        this.logger.debug(
          `Autocomplete GPS bias: ${lat}, ${lng}`,
        );
      }

      /**
       * Google Places API (New).
       */
      const response = await fetch(
        `${this.placesBaseUrl}/places:autocomplete`,
        {
          method: 'POST',

          headers: {
            'Content-Type': 'application/json',

            'X-Goog-Api-Key':
              this.apiKey,

            'X-Goog-FieldMask':
              [
                'suggestions.placePrediction.place',
                'suggestions.placePrediction.placeId',
                'suggestions.placePrediction.text.text',
                'suggestions.placePrediction.structuredFormat.mainText.text',
                'suggestions.placePrediction.structuredFormat.secondaryText.text',
              ].join(','),
          },

          body: JSON.stringify(body),

          signal:
            AbortSignal.timeout(5000),
        },
      );

      /**
       * IMPORTANT:
       *
       * Log Google's actual response.
       *
       * This prevents Google errors from silently
       * becoming [].
       */
      const responseText =
        await response.text();

      this.logger.warn(
        `GOOGLE AUTOCOMPLETE STATUS: ${response.status}`,
      );

      this.logger.warn(
        `GOOGLE AUTOCOMPLETE RESPONSE: ${responseText}`,
      );

      if (!response.ok) {
        this.logger.error(
          `Google Places Autocomplete failed with HTTP ${response.status}`,
        );

        return [];
      }

      let json: any;

      try {
        json =
          JSON.parse(responseText);
      } catch {
        this.logger.error(
          'Google Places returned invalid JSON',
        );

        return [];
      }

      if (
        !Array.isArray(
          json?.suggestions,
        )
      ) {
        this.logger.warn(
          'Google Places returned no suggestions array',
        );

        return [];
      }

      /**
       * Extract place predictions.
       *
       * Deliberately NOT fetching Place Details here for every
       * prediction - that was calling Google's GetPlaceRequest
       * (a separate, more tightly quota-limited call) up to 5 times
       * per search, for suggestions a person almost never all
       * actually visits. Confirmed live: this alone hit Google's
       * 100/day GetPlaceRequest quota after normal testing use.
       * Full coordinates are now only fetched once someone actually
       * taps a specific suggestion, via getPlaceDetailsById() below.
       */
      const predictions: PlaceSuggestion[] = json.suggestions
        .map((item: any) => item?.placePrediction)
        .filter((prediction: any) => prediction?.placeId)
        .slice(0, resultLimit)
        .map((prediction: any) => ({
          placeId: prediction.placeId,
          description:
            prediction.text?.text ??
            [prediction.structuredFormat?.mainText?.text, prediction.structuredFormat?.secondaryText?.text]
              .filter(Boolean)
              .join(', '),
        }));

      return predictions;
    } catch (error) {
      this.logger.error(
        'Places Autocomplete request failed',
        error instanceof Error
          ? error.stack
          : String(error),
      );

      return [];
    }
  }

  /**
   * Fetches full coordinates/formatted address for a single place_id -
   * split out from suggest() specifically so this (quota-limited)
   * Google call only happens once, for whichever one suggestion a
   * person actually selects, not for every suggestion shown.
   */
  async getPlaceDetailsById(placeId: string): Promise<GeocodeResult | null> {
    if (!this.isConfigured() || !placeId?.trim()) return null;
    return this.getPlaceDetails({ placeId: placeId.trim() });
  }

  /**
   * ============================================================
   * PLACE DETAILS
   * ============================================================
   */
  private async getPlaceDetails(
    prediction: any,
  ): Promise<GeocodeResult | null> {
    const placeId =
      prediction?.placeId;

    if (!placeId) {
      return null;
    }

    try {
      /**
       * IMPORTANT:
       *
       * Correct Places API (New) URL:
       *
       * /v1/places/{PLACE_ID}
       */
      const response = await fetch(
        `${this.placesBaseUrl}/places/${encodeURIComponent(
          placeId,
        )}`,
        {
          method: 'GET',

          headers: {
            'X-Goog-Api-Key':
              this.apiKey,

            'X-Goog-FieldMask':
              [
                'location',
                'formattedAddress',
                'addressComponents',
              ].join(','),
          },

          signal:
            AbortSignal.timeout(5000),
        },
      );

      const responseText =
        await response.text();

      if (!response.ok) {
        this.logger.warn(
          `Google Place Details HTTP ${response.status} for ${placeId}: ${responseText}`,
        );

        return null;
      }

      let result: any;

      try {
        result =
          JSON.parse(responseText);
      } catch {
        return null;
      }

      if (
        !result?.location ||
        !Number.isFinite(
          result.location.latitude,
        ) ||
        !Number.isFinite(
          result.location.longitude,
        )
      ) {
        return null;
      }

      /**
       * HARD Nigeria validation.
       */
      if (!this.isNigeria(result)) {
        this.logger.warn(
          `Rejected non-Nigeria place: ${
            result.formattedAddress ??
            placeId
          }`,
        );

        return null;
      }

      return {
        lat:
          result.location.latitude,

        lng:
          result.location.longitude,

        formattedAddress:
          result.formattedAddress ??
          prediction?.text?.text ??
          '',
      };
    } catch (error) {
      this.logger.warn(
        `Place Details failed for ${placeId}: ${
          error instanceof Error
            ? error.message
            : String(error)
        }`,
      );

      return null;
    }
  }

  /**
   * ============================================================
   * GEOCODING
   * ============================================================
   */
  async geocode(
    address: string,
  ): Promise<GeocodeResult | null> {
    if (
      !this.isConfigured() ||
      !address?.trim()
    ) {
      return null;
    }

    try {
      const params =
        new URLSearchParams({
          address:
            address.trim(),

          components:
            'country:NG',

          key:
            this.apiKey,
        });

      const response =
        await fetch(
          `${this.mapsBaseUrl}/geocode/json?${params.toString()}`,
          {
            signal:
              AbortSignal.timeout(5000),
          },
        );

      if (!response.ok) {
        this.logger.warn(
          `Geocode HTTP ${response.status}`,
        );

        return null;
      }

      const json =
        await response.json();

      if (
        json.status !== 'OK' ||
        !Array.isArray(
          json.results,
        )
      ) {
        this.logger.warn(
          `Geocode failed: ${json.status}`,
        );

        return null;
      }

      const result =
        json.results.find(
          (item: any) =>
            this.isNigeria(item),
        );

      if (
        !result?.geometry?.location
      ) {
        return null;
      }

      return {
        lat:
          result.geometry.location.lat,

        lng:
          result.geometry.location.lng,

        formattedAddress:
          result.formatted_address ??
          address.trim(),
      };
    } catch (error) {
      this.logger.error(
        'Geocode request failed',
        error instanceof Error
          ? error.stack
          : String(error),
      );

      return null;
    }
  }

  /**
   * ============================================================
   * REVERSE GEOCODING
   * ============================================================
   */
  async reverseGeocode(
    lat: number,
    lng: number,
  ): Promise<GeocodeResult | null> {
    if (
      !this.isConfigured() ||
      !this.isValidCoordinate(lat, lng)
    ) {
      this.logger.warn(
        `Reverse geocode skipped - not configured or invalid coordinate: ${lat}, ${lng}`,
      );
      return null;
    }

    /**
     * Only allow Nigerian coordinates.
     */
    if (
      !this.isPlausibleNigeriaCoordinate(
        lat,
        lng,
      )
    ) {
      this.logger.warn(
        `Reverse geocode rejected foreign coordinates: ${lat}, ${lng}`,
      );

      return null;
    }

    try {
      const params =
        new URLSearchParams({
          latlng:
            `${lat},${lng}`,

          key:
            this.apiKey,
        });

      const response =
        await fetch(
          `${this.mapsBaseUrl}/geocode/json?${params.toString()}`,
          {
            signal:
              AbortSignal.timeout(5000),
          },
        );

      // This function had NO logging at all on any failure path before -
      // every other method in this file logs the actual Google response
      // on failure, this one silently returned null no matter what
      // Google actually said. That's why a genuine 400 on a known-good
      // Lagos coordinate (6.5244, 3.3792) produced nothing in the logs
      // to diagnose from.
      const responseText = await response.text();

      if (!response.ok) {
        this.logger.warn(
          `Reverse geocode HTTP ${response.status} for ${lat},${lng}: ${responseText}`,
        );
        return null;
      }

      let json: any;
      try {
        json = JSON.parse(responseText);
      } catch {
        this.logger.error(`Reverse geocode returned invalid JSON for ${lat},${lng}: ${responseText}`);
        return null;
      }

      if (
        json.status !== 'OK' ||
        !Array.isArray(
          json.results,
        )
      ) {
        this.logger.warn(
          `Reverse geocode Google status for ${lat},${lng}: ${json.status} - ${JSON.stringify(json.error_message ?? json)}`,
        );
        return null;
      }

      const result =
        json.results.find(
          (item: any) =>
            this.isNigeria(item),
        );

      if (
        !result?.geometry?.location
      ) {
        // Distinguishes this specific failure mode from every other
        // one above: Google succeeded and returned real results, but
        // isNigeria() rejected every single one of them - worth
        // knowing which country Google actually thought this was,
        // since that's a genuinely different bug than "Google failed."
        const firstResultCountry = json.results[0]?.address_components?.find((c: any) =>
          c.types?.includes('country'),
        )?.short_name;
        this.logger.warn(
          `Reverse geocode for ${lat},${lng}: Google returned ${json.results.length} result(s) but none passed isNigeria() - first result's country was '${firstResultCountry ?? 'unknown'}'`,
        );
        return null;
      }

      return {
        lat:
          result.geometry.location.lat,

        lng:
          result.geometry.location.lng,

        formattedAddress:
          result.formatted_address ??
          `${lat}, ${lng}`,
      };
    } catch (error) {
      this.logger.error(
        'Reverse geocode request failed',
        error instanceof Error
          ? error.stack
          : String(error),
      );

      return null;
    }
  }

  /**
   * ============================================================
   * DIRECTIONS
   * ============================================================
   */
  async getDirections(
    origin: {
      lat: number;
      lng: number;
    },
    destination: {
      lat: number;
      lng: number;
    },
  ): Promise<DirectionsResult | null> {
    if (
      !this.isConfigured()
    ) {
      return null;
    }

    /**
     * Do not route outside Nigeria.
     */
    if (
      !this.isPlausibleNigeriaCoordinate(
        origin.lat,
        origin.lng,
      ) ||
      !this.isPlausibleNigeriaCoordinate(
        destination.lat,
        destination.lng,
      )
    ) {
      this.logger.warn(
        'Directions rejected because coordinates are outside Nigeria',
      );

      return null;
    }

    try {
      const params =
        new URLSearchParams({
          origin:
            `${origin.lat},${origin.lng}`,

          destination:
            `${destination.lat},${destination.lng}`,

          key:
            this.apiKey,
        });

      const response =
        await fetch(
          `${this.mapsBaseUrl}/directions/json?${params.toString()}`,
          {
            signal:
              AbortSignal.timeout(5000),
          },
        );

      if (!response.ok) {
        return null;
      }

      const json =
        await response.json();

      if (
        json.status !== 'OK' ||
        !Array.isArray(
          json.routes,
        ) ||
        !json.routes.length
      ) {
        this.logger.warn(
          `Directions failed: ${json.status}`,
        );

        return null;
      }

      const route =
        json.routes[0];

      const leg =
        route?.legs?.[0];

      if (
        !leg?.distance?.value ||
        !leg?.duration?.value
      ) {
        return null;
      }

      return {
        distanceKm:
          leg.distance.value /
          1000,

        durationMin:
          Math.ceil(
            leg.duration.value /
              60,
          ),

        polyline:
          route
            .overview_polyline
            ?.points ?? null,
      };
    } catch (error) {
      this.logger.error(
        'Directions request failed',
        error instanceof Error
          ? error.stack
          : String(error),
      );

      return null;
    }
  }

  /**
   * ============================================================
   * DISTANCE MATRIX
   * ============================================================
   *
   * Batch ETA lookup: many origins against ONE destination in a
   * single Google call, instead of one getDirections() call per
   * origin. Built specifically for DriverRankingService.rank(),
   * which needs road ETA from up to `dispatch.etaCandidateLimit`
   * candidate drivers to one pickup point — that's exactly Distance
   * Matrix's "many origins, one destination" shape.
   *
   * Google caps origins at 25 per call; callers here already slice
   * to a much smaller shortlist before this is reached, but the cap
   * is enforced anyway so a future caller can't silently exceed it.
   *
   * Returns null only when the WHOLE call fails (not configured, no
   * valid origins, HTTP/network failure, or a top-level Google
   * error status) - see DistanceMatrixElement's own doc comment for
   * why an individual origin failing does NOT null the whole result.
   */
  private static readonly MAX_DISTANCE_MATRIX_ORIGINS = 25;

  async getDistanceMatrix(
    origins: { lat: number; lng: number }[],
    destination: { lat: number; lng: number },
  ): Promise<DistanceMatrixElement[] | null> {
    if (!this.isConfigured()) {
      return null;
    }

    if (!Array.isArray(origins) || origins.length === 0) {
      return null;
    }

    if (origins.length > GoogleMapsService.MAX_DISTANCE_MATRIX_ORIGINS) {
      this.logger.warn(
        `Distance Matrix rejected: ${origins.length} origins exceeds Google's ${GoogleMapsService.MAX_DISTANCE_MATRIX_ORIGINS}-origin limit`,
      );
      return null;
    }

    if (!this.isPlausibleNigeriaCoordinate(destination.lat, destination.lng)) {
      this.logger.warn('Distance Matrix rejected because destination is outside Nigeria');
      return null;
    }

    // Origins outside Nigeria don't fail the whole batch - they're
    // just excluded from the Google request and their slot in the
    // returned array comes back null, same as any other per-origin
    // failure. validIndices lets us map Google's positional response
    // (which only knows about the origins we actually sent) back onto
    // the caller's original array positions.
    const validIndices: number[] = [];
    const validOrigins: string[] = [];
    origins.forEach((origin, index) => {
      if (this.isPlausibleNigeriaCoordinate(origin.lat, origin.lng)) {
        validIndices.push(index);
        validOrigins.push(`${origin.lat},${origin.lng}`);
      }
    });

    const results: DistanceMatrixElement[] = new Array(origins.length).fill(null);

    if (validOrigins.length === 0) {
      this.logger.warn('Distance Matrix rejected: no origins had plausible Nigeria coordinates');
      return results;
    }

    try {
      const params = new URLSearchParams({
        origins: validOrigins.join('|'),
        destinations: `${destination.lat},${destination.lng}`,
        key: this.apiKey,
      });

      const response = await fetch(`${this.mapsBaseUrl}/distancematrix/json?${params.toString()}`, {
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        this.logger.warn(`Distance Matrix HTTP ${response.status}`);
        return null;
      }

      const json = await response.json();

      if (json.status !== 'OK' || !Array.isArray(json.rows)) {
        this.logger.warn(`Distance Matrix failed: ${json.status}`);
        return null;
      }

      // rows[i] corresponds to validOrigins[i] (Google preserves
      // origin order), and each row has exactly one element since we
      // only ever send a single destination.
      json.rows.forEach((row: any, rowIndex: number) => {
        const originalIndex = validIndices[rowIndex];
        if (originalIndex === undefined) return;

        const element = row?.elements?.[0];
        if (element?.status !== 'OK' || !element?.distance?.value || !element?.duration?.value) {
          if (element?.status && element.status !== 'OK') {
            this.logger.warn(`Distance Matrix element ${rowIndex} failed: ${element.status}`);
          }
          return;
        }

        results[originalIndex] = {
          distanceKm: element.distance.value / 1000,
          durationMin: Math.ceil(element.duration.value / 60),
        };
      });

      return results;
    } catch (error) {
      this.logger.error('Distance Matrix request failed', error instanceof Error ? error.stack : String(error));
      return null;
    }
  }
}
