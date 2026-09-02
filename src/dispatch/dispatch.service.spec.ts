import { DispatchService } from './dispatch.service';
import { RideOfferStatus } from './entities/ride-offer.entity';

function fakeOffer(overrides: Partial<any> = {}) {
  return {
    id: 'offer-1',
    rideId: 'ride-1',
    driverUserId: 'driver-1',
    status: RideOfferStatus.PENDING,
    distanceKm: 2,
    offeredAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
    ...overrides,
  };
}

function buildService(overrides: Record<string, any> = {}) {
  const offersRepo = {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    count: jest.fn().mockResolvedValue(0),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    create: jest.fn((x: any) => x),
    save: jest.fn(async (x: any) => x),
    ...overrides.offersRepo,
  };
  const ridesRepo = {
    findOne: jest.fn().mockResolvedValue({ id: 'ride-1', pickupLat: 6.5, pickupLng: 3.3, pickupAddress: 'Somewhere' }),
    ...overrides.ridesRepo,
  };
  const driversService = { findNearby: jest.fn().mockResolvedValue([]), ...overrides.driversService };
  const dispatchAiService = { rankDrivers: jest.fn((c: any[]) => c), ...overrides.dispatchAiService };
  const featureFlagsService = { isEnabled: jest.fn().mockResolvedValue(false), ...overrides.featureFlagsService };
  const config = { get: jest.fn().mockReturnValue(60), ...overrides.config };
  const events = { emit: jest.fn(), ...overrides.events };
  const metricsService = {
    dispatchOffersTotal: { inc: jest.fn() },
    dispatchOfferTimeoutsTotal: { inc: jest.fn() },
    ...overrides.metricsService,
  };
  const candidateSearchService = { search: jest.fn(), ...overrides.candidateSearchService };
  const driverRankingService = { rank: jest.fn().mockResolvedValue({ ranked: [], routingCallsMade: 0, routingFailures: 0, fallbackUsed: false }), ...overrides.driverRankingService };

  const service = new DispatchService(
    offersRepo as any,
    ridesRepo as any,
    driversService as any,
    dispatchAiService as any,
    featureFlagsService as any,
    config as any,
    events as any,
    metricsService as any,
    candidateSearchService as any,
    driverRankingService as any,
  );

  return { service, offersRepo, ridesRepo, driversService, events, metricsService, candidateSearchService };
}

describe('DispatchService', () => {
  describe('offerToSpecificDriver', () => {
    it('uses the caller-supplied distanceKm and never re-scans PostgreSQL for it', async () => {
      const { service, offersRepo, driversService, events } = buildService();

      await service.offerToSpecificDriver('ride-1', 'driver-1', 4.5);

      expect(driversService.findNearby).not.toHaveBeenCalled();
      expect(offersRepo.create).toHaveBeenCalledWith(expect.objectContaining({ distanceKm: 4.5 }));
      expect(events.emit).toHaveBeenCalledWith('ride.offered', expect.objectContaining({ distanceKm: 4.5 }));
    });

    it('falls back to the legacy findNearby scan only when no distanceKm is supplied', async () => {
      const { service, driversService } = buildService({
        driversService: {
          findNearby: jest.fn().mockResolvedValue([{ userId: 'driver-1', distanceKm: 3.1 }]),
        },
      });

      const offer = await service.offerToSpecificDriver('ride-1', 'driver-1');

      expect(driversService.findNearby).toHaveBeenCalledTimes(1);
      expect(offer.distanceKm).toBe(3.1);
    });
  });

  describe('markDeclined', () => {
    it('emits ride.offer.declined when a pending offer was actually declined', async () => {
      const { service, offersRepo, events } = buildService({
        offersRepo: { update: jest.fn().mockResolvedValue({ affected: 1 }) },
      });

      await service.markDeclined('ride-1', 'driver-1');

      expect(events.emit).toHaveBeenCalledWith('ride.offer.declined', { rideId: 'ride-1', driverUserId: 'driver-1' });
    });

    it('does not emit when there was nothing pending to decline', async () => {
      const { service, events } = buildService({
        offersRepo: { update: jest.fn().mockResolvedValue({ affected: 0 }) },
      });

      await service.markDeclined('ride-1', 'driver-1');

      expect(events.emit).not.toHaveBeenCalled();
    });
  });

  describe('getTriedDriverUserIds', () => {
    it('returns the distinct set of every driver ever offered this ride', async () => {
      const { service, offersRepo } = buildService({
        offersRepo: {
          find: jest.fn().mockResolvedValue([
            fakeOffer({ driverUserId: 'driver-1', status: RideOfferStatus.DECLINED }),
            fakeOffer({ driverUserId: 'driver-2', status: RideOfferStatus.EXPIRED }),
            fakeOffer({ driverUserId: 'driver-1', status: RideOfferStatus.DECLINED, id: 'offer-2' }),
          ]),
        },
      });

      const ids = await service.getTriedDriverUserIds('ride-1');

      expect(ids.sort()).toEqual(['driver-1', 'driver-2']);
    });
  });

  describe('expireStaleOffersAndReassign', () => {
    it('emits ride.offer.expired for every offer it expires', async () => {
      const stale = [fakeOffer({ id: 'offer-1', driverUserId: 'driver-1' }), fakeOffer({ id: 'offer-2', driverUserId: 'driver-2', rideId: 'ride-2' })];
      const { service, offersRepo, events } = buildService({
        offersRepo: {
          find: jest.fn().mockResolvedValue(stale),
          save: jest.fn(async (x: any) => x),
        },
      });

      await service.expireStaleOffersAndReassign();

      expect(offersRepo.save).toHaveBeenCalled();
      expect(events.emit).toHaveBeenCalledWith('ride.offer.expired', { rideId: 'ride-1', driverUserId: 'driver-1' });
      expect(events.emit).toHaveBeenCalledWith('ride.offer.expired', { rideId: 'ride-2', driverUserId: 'driver-2' });
    });

    it('does nothing when there is nothing stale', async () => {
      const { service, offersRepo, events } = buildService({
        offersRepo: { find: jest.fn().mockResolvedValue([]) },
      });

      await service.expireStaleOffersAndReassign();

      expect(offersRepo.save).not.toHaveBeenCalled();
      expect(events.emit).not.toHaveBeenCalled();
    });

    it('records offer_timeout_rate\'s numerator (dispatchOfferTimeoutsTotal) once per expired offer, MANUAL or AUTO alike', async () => {
      const stale = [fakeOffer({ id: 'offer-1', driverUserId: 'driver-1' }), fakeOffer({ id: 'offer-2', driverUserId: 'driver-2', rideId: 'ride-2' })];
      const { service, metricsService } = buildService({
        offersRepo: {
          find: jest.fn().mockResolvedValue(stale),
          save: jest.fn(async (x: any) => x),
        },
      });

      await service.expireStaleOffersAndReassign();

      expect(metricsService.dispatchOfferTimeoutsTotal.inc).toHaveBeenCalledWith(2);
    });
  });
});
