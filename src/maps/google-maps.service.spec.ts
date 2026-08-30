import { GoogleMapsService } from './google-maps.service';

const LAGOS = { lat: 6.5244, lng: 3.3792 };
const LAGOS_2 = { lat: 6.53, lng: 3.381 };
const LONDON = { lat: 51.5072, lng: -0.1276 }; // outside the Nigeria bounds check

function buildService(apiKey = 'test-key') {
  const config = { get: (key: string) => (key === 'googleMaps.apiKey' ? apiKey : undefined) } as any;
  return new GoogleMapsService(config);
}

function mockFetchOnce(body: any, ok = true, status = 200) {
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as any);
}

describe('GoogleMapsService.getDistanceMatrix', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  it('returns null immediately when no API key is configured, without calling fetch', async () => {
    const service = buildService('');

    const result = await service.getDistanceMatrix([LAGOS], LAGOS_2);

    expect(result).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns null when given an empty origins array', async () => {
    const service = buildService();

    const result = await service.getDistanceMatrix([], LAGOS_2);

    expect(result).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('rejects a destination outside Nigeria without calling fetch', async () => {
    const service = buildService();

    const result = await service.getDistanceMatrix([LAGOS], LONDON);

    expect(result).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('maps each row back to its origin by position, in the order origins were given', async () => {
    const service = buildService();
    mockFetchOnce({
      status: 'OK',
      rows: [
        { elements: [{ status: 'OK', distance: { value: 2000 }, duration: { value: 300 } }] },
        { elements: [{ status: 'OK', distance: { value: 5000 }, duration: { value: 600 } }] },
      ],
    });

    const result = await service.getDistanceMatrix([LAGOS, LAGOS_2], LAGOS_2);

    expect(result).toEqual([
      { distanceKm: 2, durationMin: 5 },
      { distanceKm: 5, durationMin: 10 },
    ]);
  });

  it('nulls out only the failing element on a per-origin failure, without discarding the rest of the batch', async () => {
    const service = buildService();
    mockFetchOnce({
      status: 'OK',
      rows: [
        { elements: [{ status: 'OK', distance: { value: 2000 }, duration: { value: 300 } }] },
        { elements: [{ status: 'ZERO_RESULTS' }] },
      ],
    });

    const result = await service.getDistanceMatrix([LAGOS, LAGOS_2], LAGOS_2);

    expect(result).toEqual([{ distanceKm: 2, durationMin: 5 }, null]);
  });

  it('excludes an origin outside Nigeria from the request but preserves its slot as null in the result', async () => {
    const service = buildService();
    mockFetchOnce({
      status: 'OK',
      // Only ONE row comes back — Google never saw the London origin,
      // since it was filtered out before the request was built.
      rows: [{ elements: [{ status: 'OK', distance: { value: 2000 }, duration: { value: 300 } }] }],
    });

    const result = await service.getDistanceMatrix([LAGOS, LONDON], LAGOS_2);

    expect(result).toEqual([{ distanceKm: 2, durationMin: 5 }, null]);
    const requestedUrl = (global.fetch as jest.Mock).mock.calls[0][0] as string;
    expect(requestedUrl).toContain(new URLSearchParams({ origins: `${LAGOS.lat},${LAGOS.lng}` }).toString());
    expect(requestedUrl).not.toContain(`${LONDON.lat}`);
  });

  it('returns an all-null array (not null) when every origin is outside Nigeria', async () => {
    const service = buildService();

    const result = await service.getDistanceMatrix([LONDON], LAGOS_2);

    expect(result).toEqual([null]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns null on a top-level Google error status', async () => {
    const service = buildService();
    mockFetchOnce({ status: 'REQUEST_DENIED' });

    const result = await service.getDistanceMatrix([LAGOS], LAGOS_2);

    expect(result).toBeNull();
  });

  it('returns null on an HTTP failure', async () => {
    const service = buildService();
    mockFetchOnce({}, false, 500);

    const result = await service.getDistanceMatrix([LAGOS], LAGOS_2);

    expect(result).toBeNull();
  });

  it('returns null (not throws) when fetch itself rejects', async () => {
    const service = buildService();
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('network blew up'));

    const result = await service.getDistanceMatrix([LAGOS], LAGOS_2);

    expect(result).toBeNull();
  });

  it('rejects a batch larger than Google\'s 25-origin limit without calling fetch', async () => {
    const service = buildService();
    const tooManyOrigins = Array.from({ length: 26 }, () => LAGOS);

    const result = await service.getDistanceMatrix(tooManyOrigins, LAGOS_2);

    expect(result).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
