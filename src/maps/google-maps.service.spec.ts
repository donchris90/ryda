import { GoogleMapsService } from './google-maps.service';

function fakeResponse(json: any, ok = true) {
  return { ok, json: jest.fn().mockResolvedValue(json) } as any;
}

function build(configOverrides: Record<string, any> = {}) {
  const configValues: Record<string, any> = {
    'googleMaps.apiKey': 'fake-key',
    'mapsServiceRegion.countryCode': 'NG',
    'mapsServiceRegion.boundingBox': { minLat: 4, maxLat: 14, minLng: 2, maxLng: 15 },
    ...configOverrides,
  };
  const config = { get: jest.fn((key: string) => configValues[key]) };
  const service = new GoogleMapsService(config as any);
  return { service };
}

const LAGOS_ORIGIN = { lat: 6.6018, lng: 3.3515 };
const LAGOS_DEST = { lat: 6.4667, lng: 3.2833 };
const LONDON = { lat: 51.5074, lng: -0.1278 };

function routeWithLeg(overrides: Record<string, any> = {}) {
  return {
    legs: [
      {
        distance: { value: 10000 },
        duration: { value: 1200 },
        ...overrides,
      },
    ],
    overview_polyline: { points: 'fakepolyline' },
  };
}

describe('GoogleMapsService.getDirections()', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as any;
  });

  it('uses duration_in_traffic and marks isTrafficAware=true when Google genuinely returns real-time traffic data', async () => {
    const { service } = build();
    fetchMock.mockResolvedValue(
      fakeResponse({
        status: 'OK',
        routes: [routeWithLeg({ duration_in_traffic: { value: 1800 } })],
      }),
    );

    const result = await service.getDirections(LAGOS_ORIGIN, LAGOS_DEST);

    expect(result?.durationMin).toBe(30);
    expect(result?.isTrafficAware).toBe(true);
  });

  it('falls back to the normal duration and marks isTrafficAware=false when Google has no traffic data for this route', async () => {
    const { service } = build();
    fetchMock.mockResolvedValue(
      fakeResponse({ status: 'OK', routes: [routeWithLeg()] }),
    );

    const result = await service.getDirections(LAGOS_ORIGIN, LAGOS_DEST);

    expect(result?.durationMin).toBe(20);
    expect(result?.isTrafficAware).toBe(false);
  });

  it('returns genuine alternative routes when Google provides more than one', async () => {
    const { service } = build();
    fetchMock.mockResolvedValue(
      fakeResponse({
        status: 'OK',
        routes: [
          routeWithLeg({ distance: { value: 10000 }, duration: { value: 1200 } }),
          routeWithLeg({ distance: { value: 12000 }, duration: { value: 1500 } }),
        ],
      }),
    );

    const result = await service.getDirections(LAGOS_ORIGIN, LAGOS_DEST);

    expect(result?.alternativeRoutes).toHaveLength(1);
    expect(result?.alternativeRoutes[0].distanceKm).toBe(12);
  });

  it('returns an empty alternativeRoutes array when Google only has one viable route', async () => {
    const { service } = build();
    fetchMock.mockResolvedValue(fakeResponse({ status: 'OK', routes: [routeWithLeg()] }));

    const result = await service.getDirections(LAGOS_ORIGIN, LAGOS_DEST);

    expect(result?.alternativeRoutes).toEqual([]);
  });

  it('genuinely requests traffic-aware data and alternatives from Google, not just parses them opportunistically', async () => {
    const { service } = build();
    fetchMock.mockResolvedValue(fakeResponse({ status: 'OK', routes: [routeWithLeg()] }));

    await service.getDirections(LAGOS_ORIGIN, LAGOS_DEST);

    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain('departure_time=now');
    expect(calledUrl).toContain('traffic_model=best_guess');
    expect(calledUrl).toContain('alternatives=true');
  });

  it('rejects coordinates outside the configured service region bounding box, without ever calling Google', async () => {
    const { service } = build();

    const result = await service.getDirections(LAGOS_ORIGIN, LONDON);

    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('respects a genuinely different configured bounding box - not hard-coded to Nigeria', async () => {
    const { service } = build({
      'mapsServiceRegion.boundingBox': { minLat: 50, maxLat: 52, minLng: -1, maxLng: 1 },
    });
    fetchMock.mockResolvedValue(fakeResponse({ status: 'OK', routes: [routeWithLeg()] }));

    const result = await service.getDirections(LONDON, { lat: 51.51, lng: -0.13 });

    expect(result).not.toBeNull();
    expect(fetchMock).toHaveBeenCalled();
  });
});

describe('GoogleMapsService.snapToRoad()', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as any;
  });

  it('reports a genuine snap when the returned point is meaningfully different from the input (off-road pickup)', async () => {
    const { service } = build();
    fetchMock.mockResolvedValue(
      fakeResponse({ snappedPoints: [{ location: { latitude: 6.5250, longitude: 3.3800 } }] }),
    );

    const result = await service.snapToRoad(6.5244, 3.3792); // input a couple hundred meters from the "snapped" point

    expect(result?.wasSnapped).toBe(true);
    expect(result?.lat).toBe(6.525);
    expect(result?.lng).toBe(3.38);
  });

  it('reports no genuine snap when the returned point is within GPS-jitter distance of the input', async () => {
    const { service } = build();
    fetchMock.mockResolvedValue(
      fakeResponse({ snappedPoints: [{ location: { latitude: 6.52440001, longitude: 3.37920001 } }] }),
    );

    const result = await service.snapToRoad(6.5244, 3.3792);

    expect(result?.wasSnapped).toBe(false);
  });

  it('returns null (not an error) when Google has no snapped points for this location', async () => {
    const { service } = build();
    fetchMock.mockResolvedValue(fakeResponse({ snappedPoints: [] }));

    const result = await service.snapToRoad(6.5244, 3.3792);

    expect(result).toBeNull();
  });

  it('returns null when the Roads API request itself fails', async () => {
    const { service } = build();
    fetchMock.mockResolvedValue(fakeResponse({}, false));

    const result = await service.snapToRoad(6.5244, 3.3792);

    expect(result).toBeNull();
  });

  it('rejects an invalid coordinate without ever calling Google', async () => {
    const { service } = build();

    const result = await service.snapToRoad(999, 999);

    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

function fakeTextResponse(json: any, ok = true) {
  return { ok, text: jest.fn().mockResolvedValue(JSON.stringify(json)) } as any;
}

const NIGERIA_ADDRESS_COMPONENTS = [
  { shortText: 'NG', types: ['country'] },
];

describe('GoogleMapsService.getPlaceDetailsById()', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as any;
  });

  it('does not request the entrances field when includeEntrances is not passed', async () => {
    const { service } = build();
    fetchMock.mockResolvedValue(
      fakeTextResponse({
        location: { latitude: 6.5244, longitude: 3.3792 },
        formattedAddress: 'Some Place, Lagos',
        addressComponents: NIGERIA_ADDRESS_COMPONENTS,
      }),
    );

    const result = await service.getPlaceDetailsById('place123');

    expect(result?.entrances).toBeUndefined();
    const [, options] = fetchMock.mock.calls[0];
    expect(options.headers['X-Goog-FieldMask']).not.toContain('entrances');
  });

  it('requests and returns entrance coordinates when includeEntrances=true', async () => {
    const { service } = build();
    fetchMock.mockResolvedValue(
      fakeTextResponse({
        location: { latitude: 6.5244, longitude: 3.3792 },
        formattedAddress: 'Ikeja City Mall, Lagos',
        addressComponents: NIGERIA_ADDRESS_COMPONENTS,
        entrances: [
          { location: { latitude: 6.5245, longitude: 3.3793 } },
          { location: { latitude: 6.5240, longitude: 3.3790 } },
        ],
      }),
    );

    const result = await service.getPlaceDetailsById('place123', true);

    expect(result?.entrances).toEqual([
      { lat: 6.5245, lng: 3.3793 },
      { lat: 6.5240, lng: 3.3790 },
    ]);
    const [, options] = fetchMock.mock.calls[0];
    expect(options.headers['X-Goog-FieldMask']).toContain('entrances');
  });

  it('returns an empty entrances array (not undefined) when includeEntrances=true but Google has no entrance data', async () => {
    const { service } = build();
    fetchMock.mockResolvedValue(
      fakeTextResponse({
        location: { latitude: 6.5244, longitude: 3.3792 },
        formattedAddress: 'Small Shop, Lagos',
        addressComponents: NIGERIA_ADDRESS_COMPONENTS,
      }),
    );

    const result = await service.getPlaceDetailsById('place123', true);

    expect(result?.entrances).toEqual([]);
  });

  it('drops malformed entrance entries missing usable coordinates', async () => {
    const { service } = build();
    fetchMock.mockResolvedValue(
      fakeTextResponse({
        location: { latitude: 6.5244, longitude: 3.3792 },
        formattedAddress: 'Weird Place, Lagos',
        addressComponents: NIGERIA_ADDRESS_COMPONENTS,
        entrances: [
          { location: { latitude: 6.5245, longitude: 3.3793 } },
          { location: {} },
          {},
        ],
      }),
    );

    const result = await service.getPlaceDetailsById('place123', true);

    expect(result?.entrances).toEqual([{ lat: 6.5245, lng: 3.3793 }]);
  });
});

describe('GoogleMapsService.nearestAccessPoint()', () => {
  it('returns the entrance closest to the reference point, not just the first one', () => {
    const { service } = build();
    const entrances = [
      { lat: 6.5300, lng: 3.3900 }, // far
      { lat: 6.5245, lng: 3.3793 }, // near
    ];

    const nearest = service.nearestAccessPoint(entrances, 6.5244, 3.3792);

    expect(nearest).toEqual({ lat: 6.5245, lng: 3.3793 });
  });

  it('returns null when there are no entrances to choose from', () => {
    const { service } = build();

    expect(service.nearestAccessPoint(undefined, 6.5244, 3.3792)).toBeNull();
    expect(service.nearestAccessPoint([], 6.5244, 3.3792)).toBeNull();
  });
});
