import { MapsController } from './maps.controller';

function buildController(overrides: Record<string, any> = {}) {
  const mapsService = {
    isConfigured: jest.fn().mockReturnValue(true),
    getDirections: jest.fn(),
    suggest: jest.fn(),
    getPlaceDetailsById: jest.fn(),
    geocode: jest.fn(),
    reverseGeocode: jest.fn(),
    ...overrides.mapsService,
  };
  return { controller: new MapsController(mapsService as any), mapsService };
}

describe('MapsController.routePreview', () => {
  const dto = { pickupLat: 6.5244, pickupLng: 3.3792, dropoffLat: 6.4281, dropoffLng: 3.4219 };

  it('returns decoded route points when routing is configured and a polyline comes back', async () => {
    const { controller, mapsService } = buildController();
    // A trivial two-point encoded polyline is unnecessary to hand-construct correctly here —
    // decodePolyline() itself is exercised by rides.service's existing getRoute() tests;
    // this test only needs to confirm the controller wires the pieces together.
    mapsService.getDirections.mockResolvedValue({ distanceKm: 12, durationMin: 20, polyline: '_p~iF~ps|U_ulLnnqC_mqNvxq`@' });

    const result = await controller.routePreview(dto as any);

    expect(mapsService.getDirections).toHaveBeenCalledWith(
      { lat: dto.pickupLat, lng: dto.pickupLng },
      { lat: dto.dropoffLat, lng: dto.dropoffLng },
    );
    expect(result).not.toBeNull();
    expect(result!.points.length).toBeGreaterThan(0);
  });

  it('returns null without calling the routing API when maps is not configured', async () => {
    const { controller, mapsService } = buildController();
    mapsService.isConfigured.mockReturnValue(false);

    const result = await controller.routePreview(dto as any);

    expect(result).toBeNull();
    expect(mapsService.getDirections).not.toHaveBeenCalled();
  });

  it('returns null when directions come back with no polyline', async () => {
    const { controller, mapsService } = buildController();
    mapsService.getDirections.mockResolvedValue({ distanceKm: 12, durationMin: 20, polyline: null });

    const result = await controller.routePreview(dto as any);

    expect(result).toBeNull();
  });

  it('returns null when the routing call itself returns nothing', async () => {
    const { controller, mapsService } = buildController();
    mapsService.getDirections.mockResolvedValue(null);

    const result = await controller.routePreview(dto as any);

    expect(result).toBeNull();
  });
});

describe('MapsController.placeDetails', () => {
  it('passes includeEntrances=false by default', async () => {
    const { controller, mapsService } = buildController();
    mapsService.getPlaceDetailsById.mockResolvedValue({ lat: 6.5, lng: 3.3, formattedAddress: 'X' });

    await controller.placeDetails('place123');

    expect(mapsService.getPlaceDetailsById).toHaveBeenCalledWith('place123', false);
  });

  it('passes includeEntrances=true only when the query param is exactly "true"', async () => {
    const { controller, mapsService } = buildController();
    mapsService.getPlaceDetailsById.mockResolvedValue({ lat: 6.5, lng: 3.3, formattedAddress: 'X' });

    await controller.placeDetails('place123', 'true');

    expect(mapsService.getPlaceDetailsById).toHaveBeenCalledWith('place123', true);
  });

  it('throws when placeId is missing', async () => {
    const { controller } = buildController();

    await expect(controller.placeDetails(undefined)).rejects.toThrow('placeId is required');
  });
});
