import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { haversineDistanceKm } from '../common/utils/geo.util';

export interface AccessPoint {
  lat: number;
  lng: number;
}

export interface GeocodeResult {
  lat: number;
  lng: number;
  formattedAddress: string;
  /**
   * Building/compound entrance points from Google's `entrances` Place
   * field - distinct from the place's own centroid (lat/lng above),
   * which for anything larger than a single small shop can be tens to
   * hundreds of metres from the actual door. Only populated when
   * requested via includeEntrances (see getPlaceDetailsById) - this
   * field bumps the Place Details call from Google's Pro SKU to its
   * pricier Enterprise SKU, so callers opt in only where an exact
   * entrance genuinely matters (confirming a pickup point), not on
   * every place lookup. undefined when not requested; [] when
   * requested but Google has no entrance data for this place.
   */
  entrances?: AccessPoint[];
}

export interface PlaceSuggestion {
  placeId: string;
  description: string;
}

export interface DirectionsResult {
  distanceKm: number;
  durationMin: number;
  /** True when durationMin reflects Google's real-time traffic-aware estimate (duration_in_traffic), not just the historical/typical duration. */
  isTrafficAware: boolean;
  polyline: string | null;
  /** Other viable routes Google returned alongside the primary one - empty array when only one route exists or alternatives weren't returned. */
  alternativeRoutes: Array<{ distanceKm: number; durationMin: number; polyline: string | null }>;
}

@Injectable()
export class GoogleMapsService {
  private readonly logger = new Logger(GoogleMapsService.name);

  private readonly apiKey: string;
  private readonly serviceCountryCode: string;
  private readonly serviceBoundingBox: { minLat: number; maxLat: number; minLng: number; maxLng: number };

  private readonly mapsBaseUrl =
    'https://maps.googleapis.com/maps/api';

  private readonly placesBaseUrl =
    'https://places.googleapis.com/v1';

  private readonly roadsBaseUrl =
    'https://roads.googleapis.com/v1';

  constructor(
    private readonly config: ConfigService,
  ) {
    this.apiKey =
      this.config
        .get<string>('googleMaps.apiKey')
        ?.trim() ?? '';

    this.serviceCountryCode =
      this.config.get<string>('mapsServiceRegion.countryCode')!;
    this.serviceBoundingBox =
      this.config.get('mapsServiceRegion.boundingBox')!;
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
   * Broad service-region coordinate check - configured, not hard-coded
   * (see mapsServiceRegion.boundingBox). This is only used to
   * determine whether GPS can be used as a location bias and to
   * prevent obviously foreign coordinates from being used by Ryda.
   *
   * There is NO Lagos fallback.
   */
  private isPlausibleNigeriaCoordinate(
    lat: number,
    lng: number,
  ): boolean {
    const box = this.serviceBoundingBox;
    return (
      this.isValidCoordinate(lat, lng) &&
      lat >= box.minLat &&
      lat <= box.maxLat &&
      lng >= box.minLng &&
      lng <= box.maxLng
    );
  }

  /**
   * Validate a Google Geocoding result's country against the
   * configured service country (see mapsServiceRegion.countryCode) -
   * configured, not hard-coded.
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

    const countryCode =
      country?.short_name ??
      country?.shortText;

    return countryCode === this.serviceCountryCode;
  }

  /**
   * Picks whichever entrance is physically closest to a reference
   * point (typically the pickup coordinate a passenger actually
   * dropped their pin on) - a place can have several entrances
   * (e.g. a mall's north and south doors) and callers generally want
   * "the door nearest where this person is standing", not just
   * Google's first-listed one.
   */
  nearestAccessPoint(
    entrances: AccessPoint[] | undefined,
    refLat: number,
    refLng: number,
  ): AccessPoint | null {
    if (!entrances?.length) return null;

    return entrances.reduce((closest, candidate) => {
      const candidateDistance = haversineDistanceKm(
        refLat,
        refLng,
        candidate.lat,
        candidate.lng,
      );
      const closestDistance = haversineDistanceKm(
        refLat,
        refLng,
        closest.lat,
        closest.lng,
      );
      return candidateDistance < closestDistance ? candidate : closest;
    });
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
         * Country restriction - configured via mapsServiceRegion.countryCode,
         * not hard-coded (Places Autocomplete wants this lowercase).
         */
        includedRegionCodes: [this.serviceCountryCode.toLowerCase()],

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
  async getPlaceDetailsById(
    placeId: string,
    includeEntrances = false,
  ): Promise<GeocodeResult | null> {
    if (!this.isConfigured() || !placeId?.trim()) return null;
    return this.getPlaceDetails({ placeId: placeId.trim() }, includeEntrances);
  }

  /**
   * ============================================================
   * PLACE DETAILS
   * ============================================================
   */
  private async getPlaceDetails(
    prediction: any,
    includeEntrances = false,
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
      const fieldMask = [
        'location',
        'formattedAddress',
        'addressComponents',
      ];

      // entrances is an Enterprise-SKU field - only requested when a
      // caller genuinely needs the door location, not the building
      // centroid (see GeocodeResult.entrances doc comment).
      if (includeEntrances) {
        fieldMask.push('entrances');
      }

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
              fieldMask.join(','),
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

      const geocodeResult: GeocodeResult = {
        lat:
          result.location.latitude,

        lng:
          result.location.longitude,

        formattedAddress:
          result.formattedAddress ??
          prediction?.text?.text ??
          '',
      };

      if (includeEntrances) {
        // Google returns entrances=[] (not omitted) when it has no
        // entrance data for this place - preserve that as [], not
        // undefined, so callers can tell "asked, got nothing" apart
        // from "didn't ask".
        geocodeResult.entrances = Array.isArray(result.entrances)
          ? result.entrances
              .filter(
                (entrance: any) =>
                  Number.isFinite(entrance?.location?.latitude) &&
                  Number.isFinite(entrance?.location?.longitude),
              )
              .map((entrance: any) => ({
                lat: entrance.location.latitude,
                lng: entrance.location.longitude,
              }))
          : [];
      }

      return geocodeResult;
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
            `country:${this.serviceCountryCode}`,

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
     * Do not route outside the configured service region.
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
        'Directions rejected because coordinates are outside the configured service region',
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

          // Traffic-aware ETA: Google only returns duration_in_traffic
          // (its real-time-adjusted estimate) when departure_time is
          // explicitly supplied - "now" is the only sensible value for
          // a ride being requested/tracked in real time.
          departure_time: 'now',
          traffic_model: 'best_guess',

          // Alternative routes - Google returns more than one entry in
          // `routes` when it finds a genuinely different viable path,
          // not padding with near-duplicates.
          alternatives: 'true',

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

      // Extracts one route's leg into the same shape whether it's the
      // primary route or an alternative - single source of truth for
      // "how do we read a Google route" rather than duplicating this
      // logic for the primary route and then again for alternatives.
      const extractRoute = (route: any): { distanceKm: number; durationMin: number; isTrafficAware: boolean; polyline: string | null } | null => {
        const leg = route?.legs?.[0];
        if (!leg?.distance?.value || !leg?.duration?.value) return null;

        // duration_in_traffic is only present when Google genuinely had
        // real-time traffic data for this route - falls back to the
        // historical/typical duration otherwise, never a guess.
        const trafficSeconds = leg.duration_in_traffic?.value;
        const durationSeconds = trafficSeconds ?? leg.duration.value;

        return {
          distanceKm: leg.distance.value / 1000,
          durationMin: Math.ceil(durationSeconds / 60),
          isTrafficAware: trafficSeconds != null,
          polyline: route.overview_polyline?.points ?? null,
        };
      };

      const primary = extractRoute(json.routes[0]);
      if (!primary) return null;

      const alternativeRoutes = json.routes
        .slice(1)
        .map(extractRoute)
        .filter((r: any): r is NonNullable<typeof r> => r !== null)
        .map(({ distanceKm, durationMin, polyline }: any) => ({ distanceKm, durationMin, polyline }));

      return {
        ...primary,
        alternativeRoutes,
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
   * Snaps a point to the nearest drivable road via Google's Roads API -
   * useful when a GPS fix or a map tap lands inside a building or
   * compound rather than on the actual road a driver needs to stop on.
   * Returns null (never throws) if the API is unreachable, unconfigured,
   * or genuinely has no road within a reasonable distance - callers
   * should treat that as "keep the original point", not an error.
   */
  async snapToRoad(lat: number, lng: number): Promise<{ lat: number; lng: number; wasSnapped: boolean } | null> {
    if (!this.isConfigured()) return null;
    if (!this.isValidCoordinate(lat, lng)) return null;

    try {
      const params = new URLSearchParams({
        path: `${lat},${lng}`,
        interpolate: 'false',
        key: this.apiKey,
      });

      const response = await fetch(`${this.roadsBaseUrl}/snapToRoads?${params.toString()}`, {
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) return null;

      const json = await response.json();
      const snapped = json?.snappedPoints?.[0]?.location;
      if (!snapped || typeof snapped.latitude !== 'number' || typeof snapped.longitude !== 'number') {
        return null;
      }

      // A snap distance under ~5m is noise (GPS jitter, floating point),
      // not a genuine "this point was off-road" correction - distinguish
      // the two so callers don't silently nudge a pin that was already
      // fine.
      const movedMeters = haversineDistanceKm(lat, lng, snapped.latitude, snapped.longitude) * 1000;

      return {
        lat: snapped.latitude,
        lng: snapped.longitude,
        wasSnapped: movedMeters > 5,
      };
    } catch (error) {
      this.logger.error(
        'Snap-to-road request failed',
        error instanceof Error ? error.stack : String(error),
      );
      return null;
    }
  }
}
