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
  const expireQueryBuilder: any = {
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    returning: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({ raw: [] }),
  };

  const offersRepo = {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    count: jest.fn().mockResolvedValue(0),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    create: jest.fn((x: any) => x),
    save: jest.fn(async (x: any) => x),
    createQueryBuilder: jest.fn(() => expireQueryBuilder),
    __expireQueryBuilder: expireQueryBuilder,
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

  const service = new DispatchService(
    offersRepo as any,
    ridesRepo as any,
    driversService as any,
    dispatchAiService as any,
    featureFlagsService as any,
    config as any,
    events as any,
    metricsService as any,
  );

  return { service, offersRepo, ridesRepo, driversService, events, metricsService };
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
    it('expires via a single atomic conditional UPDATE (status=PENDING AND expiresAt<now), not a find-then-save round trip', async () => {
      const { service, offersRepo } = buildService();
      offersRepo.__expireQueryBuilder.execute.mockResolvedValue({
        raw: [{ id: 'offer-1', rideId: 'ride-1', driverUserId: 'driver-1' }],
      });

      await service.expireStaleOffersAndReassign();

      expect(offersRepo.__expireQueryBuilder.set).toHaveBeenCalledWith({ status: RideOfferStatus.EXPIRED });
      expect(offersRepo.__expireQueryBuilder.where).toHaveBeenCalledWith('status = :pending', {
        pending: RideOfferStatus.PENDING,
      });
      expect(offersRepo.__expireQueryBuilder.andWhere).toHaveBeenCalledWith(
        'expiresAt < :now',
        expect.objectContaining({ now: expect.any(Date) }),
      );
      // The old find()+save() pattern must not come back — save() on a
      // stale-read entity is exactly the blind, unconditioned UPDATE this
      // was rewritten to avoid.
      expect(offersRepo.find).not.toHaveBeenCalled();
      expect(offersRepo.save).not.toHaveBeenCalled();
    });

    it('emits ride.offer.expired only for rows the UPDATE actually touched', async () => {
      const { service, offersRepo, events } = buildService();
      offersRepo.__expireQueryBuilder.execute.mockResolvedValue({
        raw: [
          { id: 'offer-1', rideId: 'ride-1', driverUserId: 'driver-1' },
          { id: 'offer-2', rideId: 'ride-2', driverUserId: 'driver-2' },
        ],
      });

      await service.expireStaleOffersAndReassign();

      expect(events.emit).toHaveBeenCalledWith('ride.offer.expired', { rideId: 'ride-1', driverUserId: 'driver-1' });
      expect(events.emit).toHaveBeenCalledWith('ride.offer.expired', { rideId: 'ride-2', driverUserId: 'driver-2' });
      expect(events.emit).toHaveBeenCalledTimes(2);
    });

    it('does nothing when nothing was stale', async () => {
      const { service, events, metricsService } = buildService();
      // default mock already resolves { raw: [] }

      await service.expireStaleOffersAndReassign();

      expect(events.emit).not.toHaveBeenCalled();
      expect(metricsService.dispatchOfferTimeoutsTotal.inc).not.toHaveBeenCalled();
    });

    it("records offer_timeout_rate's numerator (dispatchOfferTimeoutsTotal) once per row the UPDATE actually expired, MANUAL or AUTO alike", async () => {
      const { service, offersRepo, metricsService } = buildService();
      offersRepo.__expireQueryBuilder.execute.mockResolvedValue({
        raw: [
          { id: 'offer-1', rideId: 'ride-1', driverUserId: 'driver-1' },
          { id: 'offer-2', rideId: 'ride-2', driverUserId: 'driver-2' },
        ],
      });

      await service.expireStaleOffersAndReassign();

      expect(metricsService.dispatchOfferTimeoutsTotal.inc).toHaveBeenCalledWith(2);
    });

    it('does not count or emit for an offer accepted in the same instant the sweep runs (the race the old find+save version lost)', async () => {
      // Simulates: sweep's WHERE clause is evaluated at the DB level after
      // markAccepted()'s own conditional UPDATE already committed for
      // offer-1 — so offer-1 no longer matches `status = PENDING` and the
      // atomic UPDATE below only ever touches offer-2. There is no
      // separate save() step left that could clobber offer-1 back to
      // EXPIRED, unlike the old implementation.
      const { service, offersRepo, events, metricsService } = buildService();
      offersRepo.__expireQueryBuilder.execute.mockResolvedValue({
        raw: [{ id: 'offer-2', rideId: 'ride-2', driverUserId: 'driver-2' }],
      });

      await service.expireStaleOffersAndReassign();

      expect(events.emit).not.toHaveBeenCalledWith(
        'ride.offer.expired',
        expect.objectContaining({ rideId: 'ride-1' }),
      );
      expect(metricsService.dispatchOfferTimeoutsTotal.inc).toHaveBeenCalledWith(1);
    });
  });
});
