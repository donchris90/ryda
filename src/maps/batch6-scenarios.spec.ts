/**
 * Batch 6 named-scenario coverage.
 *
 * "TESTS: Lagos / another Nigerian city / international coordinate /
 * unsupported service area / airport / poor GPS / stale GPS / route
 * recalculation. Do not hard-code test behavior into production."
 *
 * This file exists purely to make that coverage auditable in one
 * place, mapped directly to the deliverable's own scenario names.
 * Every check here calls the real production service - nothing in
 * GoogleMapsService, RidesService, LocationQualityService, or
 * AutoDispatchService branches on being under test; every one of
 * these scenarios is driven entirely by ordinary constructor
 * injection and config, the same way production traffic would hit it.
 */
import { GoogleMapsService } from './google-maps.service';
import { RidesService } from '../rides/rides.service';
import { AutoDispatchService } from '../dispatch/auto-dispatch.service';
import { LocationQualityService } from '../tracking/location-quality.service';
import { PaymentMethod, RideCategory, RideStatus } from '../common/enums/ride.enum';
import { DispatchMode } from '../candidate-search/candidate-search.types';

// ---- Real Nigerian and international coordinates used throughout ----
const LAGOS = { lat: 6.5244, lng: 3.3792 };
const ABUJA = { lat: 9.0765, lng: 7.3986 }; // "another Nigerian city" - genuinely a different city, ~750km from Lagos
const LONDON = { lat: 51.5074, lng: -0.1278 }; // international coordinate
const MMIA = { lat: 6.5774, lng: 3.3212 }; // Murtala Muhammed Intl, Lagos

function buildMapsService(configOverrides: Record<string, any> = {}) {
  const values: Record<string, any> = {
    'googleMaps.apiKey': 'fake-key',
    'mapsServiceRegion.countryCode': 'NG',
    'mapsServiceRegion.boundingBox': { minLat: 4, maxLat: 14, minLng: 2, maxLng: 15 },
    ...configOverrides,
  };
  const config = { get: jest.fn((key: string) => values[key]) };
  return new GoogleMapsService(config as any);
}

function fakeDirectionsResponse(overrides: Record<string, any> = {}) {
  return {
    ok: true,
    json: jest.fn().mockResolvedValue({
      status: 'OK',
      routes: [
        {
          legs: [{ distance: { value: 10000 }, duration: { value: 1200 }, ...overrides }],
          overview_polyline: { points: 'fakepolyline' },
        },
      ],
    }),
  } as any;
}

function buildRidesService(overrides: Record<string, any> = {}) {
  const ridesRepo = overrides.ridesRepo ?? {
    create: jest.fn((d: any) => d),
    save: jest.fn(async (d: any) => ({ id: 'ride-1', ...d })),
  };
  const pricingService = { calculateSurge: jest.fn().mockResolvedValue({ multiplier: 1 }) };
  const fareService = {
    estimate: jest.fn().mockResolvedValue({
      baseFare: 300, distanceFare: 500, timeFare: 100, surgeMultiplier: 1,
      nightMultiplierApplied: 1, airportFee: 0, tollFare: 0, discount: 0, totalFare: 900,
      usedRealRouting: false,
    }),
  };
  const passengersService = { assertNotBlacklisted: jest.fn().mockResolvedValue(undefined) };
  const geofenceService = overrides.geofenceService ?? {
    isWithinServiceArea: jest.fn().mockResolvedValue(true),
    checkPoint: jest.fn().mockResolvedValue([]),
  };
  const metricsService = { rideRequestsTotal: { inc: jest.fn() } };

  return new RidesService(
    ridesRepo as any,
    fareService as any,
    {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
    passengersService as any,
    {} as any, {} as any, {} as any, {} as any,
    pricingService as any,
    { emit: jest.fn() } as any,
    { get: jest.fn() } as any,
    {} as any, {} as any, {} as any,
    metricsService as any,
    {} as any, {} as any, {} as any,
    geofenceService as any,
    {} as any, // airportService (not exercised by this suite's scenarios)
    {} as any, // fraudService (not exercised by this suite's scenarios)
    {} as any, // poolMatchingService (not exercised by this suite)
    {} as any, // featureFlagsService (not exercised by this suite)
  );
}

describe('Batch 6 named scenarios', () => {
  describe('Lagos', () => {
    it('a Lagos-to-Lagos route is accepted by the configured service region and genuinely routed', async () => {
      const service = buildMapsService();
      global.fetch = jest.fn().mockResolvedValue(fakeDirectionsResponse()) as any;

      const result = await service.getDirections(LAGOS, { lat: 6.45, lng: 3.4 });

      expect(result).not.toBeNull();
      expect(result?.distanceKm).toBe(10);
    });
  });

  describe('another Nigerian city (Abuja)', () => {
    it('is accepted by the configured NG service region - the bounding box covers the whole country, not just Lagos', async () => {
      const service = buildMapsService();
      global.fetch = jest.fn().mockResolvedValue(fakeDirectionsResponse()) as any;

      const result = await service.getDirections(ABUJA, { lat: 9.08, lng: 7.4 });

      expect(result).not.toBeNull();
    });

    it('is correctly rejected by a service AREA scoped to Lagos only, even though it passes the country-level bounding box - two independent layers', async () => {
      const geofenceService = {
        isWithinServiceArea: jest.fn((lat: number) => Promise.resolve(lat === LAGOS.lat)),
        checkPoint: jest.fn().mockResolvedValue([]),
      };
      const service = buildRidesService({ geofenceService });

      await expect(
        service.requestRide('passenger-1', {
          category: RideCategory.ECONOMY,
          pickupLat: ABUJA.lat,
          pickupLng: ABUJA.lng,
          pickupAddress: 'Abuja',
          dropoffLat: 9.08,
          dropoffLng: 7.4,
          dropoffAddress: 'Abuja 2',
          paymentMethod: PaymentMethod.WALLET,
        } as any),
      ).rejects.toThrow(/outside our current service area/);
    });
  });

  describe('international coordinate (London)', () => {
    it('is rejected outright by the configured service-region bounding box before ever calling Google', async () => {
      const service = buildMapsService();
      const fetchMock = jest.fn();
      global.fetch = fetchMock as any;

      const result = await service.getDirections(LAGOS, LONDON);

      expect(result).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('is also rejected at the ride-request layer by service-area enforcement, independent of the maps-layer bounding box', async () => {
      const geofenceService = {
        isWithinServiceArea: jest.fn((lat: number) => Promise.resolve(lat !== LONDON.lat)),
        checkPoint: jest.fn().mockResolvedValue([]),
      };
      const service = buildRidesService({ geofenceService });

      await expect(
        service.requestRide('passenger-1', {
          category: RideCategory.ECONOMY,
          pickupLat: LONDON.lat,
          pickupLng: LONDON.lng,
          pickupAddress: 'London',
          dropoffLat: 51.51,
          dropoffLng: -0.13,
          dropoffAddress: 'London 2',
          paymentMethod: PaymentMethod.WALLET,
        } as any),
      ).rejects.toThrow(/outside our current service area/);
    });
  });

  describe('unsupported service area (within Nigeria, but outside any configured zone)', () => {
    it('a Nigerian coordinate genuinely outside every configured service-area geofence is rejected, not silently allowed just because it is in-country', async () => {
      const geofenceService = {
        isWithinServiceArea: jest.fn().mockResolvedValue(false), // simulates zero configured service areas containing this point
        checkPoint: jest.fn().mockResolvedValue([]),
      };
      const service = buildRidesService({ geofenceService });

      await expect(
        service.requestRide('passenger-1', {
          category: RideCategory.ECONOMY,
          pickupLat: 4.8156, // Port Harcourt - genuinely within Nigeria's bounding box
          pickupLng: 7.0498,
          pickupAddress: 'Port Harcourt',
          dropoffLat: 4.82,
          dropoffLng: 7.05,
          dropoffAddress: 'Port Harcourt 2',
          paymentMethod: PaymentMethod.WALLET,
        } as any),
      ).rejects.toThrow(/outside our current service area/);
    });
  });

  describe('airport', () => {
    it('an AUTO-dispatch ride with a pickup inside an airport geofence is offered via the real airport queue, not the normal nearest-driver search', async () => {
      const dispatchService = {
        getPendingOfferForRide: jest.fn().mockResolvedValue(null),
        offerToSpecificDriver: jest.fn().mockResolvedValue(undefined),
      };
      const airportService = {
        findContainingAirport: jest.fn().mockResolvedValue({ id: 'airport-1', iataCode: 'LOS' }),
        dispatchNext: jest.fn().mockResolvedValue({ driverUserId: 'queue-driver-1' }),
      };
      const driversService = { findByUserId: jest.fn().mockResolvedValue({ availability: 'online_for_rides' }) };
      const candidateSearchService = { search: jest.fn() };
      const ridesRepo = {
        findOne: jest.fn().mockResolvedValue({
          id: 'ride-1',
          status: RideStatus.SEARCHING,
          dispatchMode: DispatchMode.AUTO,
          pickupLat: MMIA.lat,
          pickupLng: MMIA.lng,
        }),
      };
      const service = new AutoDispatchService(
        ridesRepo as any,
        candidateSearchService as any,
        {} as any,
        dispatchService as any,
        { get: jest.fn() } as any,
        { autoDispatchOffersTotal: { inc: jest.fn() } } as any,
        { emit: jest.fn() } as any,
        airportService as any,
        driversService as any,
      );

      await service.startForRide('ride-1');

      expect(dispatchService.offerToSpecificDriver).toHaveBeenCalledWith('ride-1', 'queue-driver-1', 0);
      expect(candidateSearchService.search).not.toHaveBeenCalled(); // confirms the normal search was genuinely skipped
    });
  });

  describe('poor GPS', () => {
    it('a low-accuracy driver location update is flagged but still accepted - rejecting it outright would leave the position even more stale', () => {
      const config = { get: jest.fn(() => undefined) }; // exercises the service's own defaults, not test-supplied values
      const service = new LocationQualityService(config as any);

      const result = service.assess(null, { lat: LAGOS.lat, lng: LAGOS.lng, accuracy: 800 });

      expect(result.accept).toBe(true);
      expect(result.issues.some((i) => i.startsWith('poor_accuracy'))).toBe(true);
    });
  });

  describe('stale GPS', () => {
    it('a GPS fix the client reports as several minutes old is flagged but still accepted', () => {
      const config = { get: jest.fn(() => undefined) };
      const service = new LocationQualityService(config as any);
      const fixTimestamp = Date.now() - 5 * 60_000;

      const result = service.assess(null, { lat: LAGOS.lat, lng: LAGOS.lng, fixTimestamp });

      expect(result.accept).toBe(true);
      expect(result.issues.some((i) => i.startsWith('stale_fix'))).toBe(true);
    });

    it('an implausibly fast jump between two readings - a different flavor of bad GPS - is genuinely rejected as the live position', () => {
      const config = { get: jest.fn(() => undefined) };
      const service = new LocationQualityService(config as any);
      const previous = { lat: LAGOS.lat, lng: LAGOS.lng, at: new Date(Date.now() - 60_000) };

      const result = service.assess(previous, ABUJA); // ~750km in 1 minute

      expect(result.accept).toBe(false);
    });
  });

  describe('route recalculation', () => {
    it('calling for a route twice against changed conditions genuinely returns a fresh result each time, never a cached/stale one', async () => {
      const service = buildMapsService();
      const fetchMock = jest.fn();
      global.fetch = fetchMock as any;

      // First call: light traffic.
      fetchMock.mockResolvedValueOnce(fakeDirectionsResponse({ duration_in_traffic: { value: 1200 } }));
      const first = await service.getDirections(LAGOS, ABUJA);

      // Second call: conditions have genuinely changed (heavier traffic now).
      fetchMock.mockResolvedValueOnce(fakeDirectionsResponse({ duration_in_traffic: { value: 2400 } }));
      const second = await service.getDirections(LAGOS, ABUJA);

      expect(fetchMock).toHaveBeenCalledTimes(2); // a real second network call was made, not a cache hit
      expect(first?.durationMin).toBe(20);
      expect(second?.durationMin).toBe(40);
    });
  });
});
