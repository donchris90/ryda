import { NotFoundException, BadRequestException } from '@nestjs/common';
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
    findOne: jest.fn().mockResolvedValue({
      id: 'ride-1',
      pickupLat: 6.5,
      pickupLng: 3.3,
      pickupAddress: 'Somewhere',
      totalFare: '1000.00',
      city: 'Lagos',
    }),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    ...overrides.ridesRepo,
  };
  const driversService = {
    findNearby: jest.fn().mockResolvedValue([]),
    findByUserId: jest.fn().mockResolvedValue({ id: 'profile-1', level: 'standard', activeVehicleId: null, commissionOverridePercent: null }),
    ...overrides.driversService,
  };
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
  const commissionService = {
    resolveCommissionPercent: jest.fn().mockResolvedValue(20),
    ...overrides.commissionService,
  };
  const vehiclesService = {
    findById: jest.fn().mockResolvedValue({ id: 'vehicle-1', category: 'car' }),
    ...overrides.vehiclesService,
  };
  const usersService = {
    findByIds: jest.fn().mockResolvedValue([]),
    ...overrides.usersService,
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
    candidateSearchService as any,
    driverRankingService as any,
    commissionService as any,
    vehiclesService as any,
    usersService as any,
  );

  return {
    service,
    offersRepo,
    ridesRepo,
    driversService,
    events,
    metricsService,
    candidateSearchService,
    commissionService,
    vehiclesService,
    usersService,
  };
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

  describe('expireStaleManualSearches()', () => {
    function buildWithQueryBuilder(overrides: { affected?: number; staleRides?: any[] } = {}) {
      const executeMock = jest.fn().mockResolvedValue({ affected: overrides.affected ?? 1 });
      const qb = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: executeMock,
      };
      const ridesRepo = {
        find: jest.fn().mockResolvedValue(overrides.staleRides ?? []),
        createQueryBuilder: jest.fn().mockReturnValue(qb),
      };
      return buildService({ ridesRepo, config: { get: jest.fn().mockReturnValue(30) } });
    }

    it('marks a genuinely stale MANUAL ride NO_DRIVER_FOUND and emits the same event AUTO dispatch already uses', async () => {
      const staleRide = { id: 'ride-1', passengerId: 'passenger-1', driverId: null };
      const { service, events, ridesRepo } = buildWithQueryBuilder({ staleRides: [staleRide] });

      await service.expireStaleManualSearches();

      expect(ridesRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ dispatchMode: 'manual' }) }),
      );
      expect(events.emit).toHaveBeenCalledWith(
        'ride.status_changed',
        expect.objectContaining({ rideId: 'ride-1', status: 'no_driver_found' }),
      );
    });

    it('does nothing when there are no stale MANUAL rides at all', async () => {
      const { service, events } = buildWithQueryBuilder({ staleRides: [] });

      await service.expireStaleManualSearches();

      expect(events.emit).not.toHaveBeenCalled();
    });

    it('does not emit an event when the race-safe conditional update finds the ride already changed underneath it (selected/cancelled in the moment between read and write)', async () => {
      const staleRide = { id: 'ride-1', passengerId: 'passenger-1', driverId: null };
      const { service, events } = buildWithQueryBuilder({ staleRides: [staleRide], affected: 0 });

      await service.expireStaleManualSearches();

      expect(events.emit).not.toHaveBeenCalled();
    });
  });
});

describe('DispatchService offer economics', () => {
  it('computes a distance-based fallback ETA and stores it on the offer', async () => {
    const { service, offersRepo } = buildService();

    await service.offerToSpecificDriver('ride-1', 'driver-1', 14);

    // 14km / 28km/h fallback speed = 0.5h = 30 minutes
    expect(offersRepo.create).toHaveBeenCalledWith(expect.objectContaining({ etaMinutes: 30 }));
  });

  it("estimates the driver's take-home using their own resolved commission rate, not a flat guess", async () => {
    const { service, offersRepo, commissionService } = buildService({
      commissionService: { resolveCommissionPercent: jest.fn().mockResolvedValue(25) },
    });

    // totalFare 1000.00 (default mock) at 25% commission -> 750.00
    await service.offerToSpecificDriver('ride-1', 'driver-1', 4.5);

    expect(offersRepo.create).toHaveBeenCalledWith(expect.objectContaining({ estimatedDriverEarnings: '750.00' }));
  });

  it("uses the driver's commission override instead of resolving a rate, when one is set", async () => {
    const { service, offersRepo, driversService, commissionService } = buildService({
      driversService: {
        findByUserId: jest
          .fn()
          .mockResolvedValue({ id: 'profile-1', level: 'standard', activeVehicleId: null, commissionOverridePercent: '10.00' }),
      },
    });

    await service.offerToSpecificDriver('ride-1', 'driver-1', 4.5);

    expect(commissionService.resolveCommissionPercent).not.toHaveBeenCalled();
    // totalFare 1000.00 at a 10% override -> 900.00
    expect(offersRepo.create).toHaveBeenCalledWith(expect.objectContaining({ estimatedDriverEarnings: '900.00' }));
  });

  it("looks up the driver's active vehicle's category to resolve commission, when they have one", async () => {
    const { service, driversService, vehiclesService, commissionService } = buildService({
      driversService: {
        findByUserId: jest
          .fn()
          .mockResolvedValue({ id: 'profile-1', level: 'standard', activeVehicleId: 'vehicle-9', commissionOverridePercent: null }),
      },
    });

    await service.offerToSpecificDriver('ride-1', 'driver-1', 4.5);

    expect(vehiclesService.findById).toHaveBeenCalledWith('vehicle-9');
    expect(commissionService.resolveCommissionPercent).toHaveBeenCalledWith(
      expect.objectContaining({ vehicleCategory: 'car' }),
    );
  });

  it('still creates the offer, with a null estimated-earnings rather than throwing, when the driver profile lookup fails', async () => {
    const { service, offersRepo } = buildService({
      driversService: {
        findNearby: jest.fn().mockResolvedValue([]),
        findByUserId: jest.fn().mockRejectedValue(new Error('profile lookup boom')),
      },
    });

    const offer = await service.offerToSpecificDriver('ride-1', 'driver-1', 4.5);

    expect(offer).toBeDefined();
    expect(offersRepo.create).toHaveBeenCalledWith(expect.objectContaining({ estimatedDriverEarnings: null }));
  });

  it('stores a null estimated-earnings (not a crash, not NaN) when the ride itself cannot be found', async () => {
    const { service, offersRepo, ridesRepo } = buildService({ ridesRepo: { findOne: jest.fn().mockResolvedValue(null) } });

    await service.offerToSpecificDriver('ride-1', 'driver-1', 4.5);

    expect(offersRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ estimatedDriverEarnings: null, etaMinutes: expect.any(Number) }),
    );
  });
});

describe('DispatchService.getOffersForRideAdmin()', () => {
  it('returns offers in chronological order with the driver name joined in', async () => {
    const { service, offersRepo, usersService } = buildService();
    offersRepo.find.mockResolvedValue([
      { id: 'o1', driverUserId: 'driver-1', status: 'declined', distanceKm: 3, etaMinutes: 8, estimatedDriverEarnings: '700.00', offeredAt: new Date('2026-01-01T10:00:00Z'), expiresAt: new Date() },
      { id: 'o2', driverUserId: 'driver-2', status: 'accepted', distanceKm: 1.5, etaMinutes: 4, estimatedDriverEarnings: '700.00', offeredAt: new Date('2026-01-01T10:01:00Z'), expiresAt: new Date() },
    ]);
    usersService.findByIds.mockResolvedValue([
      { id: 'driver-1', firstName: 'Femi', lastName: 'Ade' },
      { id: 'driver-2', firstName: 'Chidi', lastName: 'Okoro' },
    ]);

    const result = await service.getOffersForRideAdmin('ride-1');

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(expect.objectContaining({ driverUserId: 'driver-1', driverName: 'Femi Ade', status: 'declined' }));
    expect(result[1]).toEqual(expect.objectContaining({ driverUserId: 'driver-2', driverName: 'Chidi Okoro', status: 'accepted' }));
  });

  it('reports a null driver name (not a crash) when the driver user record is missing', async () => {
    const { service, offersRepo, usersService } = buildService();
    offersRepo.find.mockResolvedValue([
      { id: 'o1', driverUserId: 'ghost-driver', status: 'expired', distanceKm: 2, etaMinutes: 5, estimatedDriverEarnings: null, offeredAt: new Date(), expiresAt: new Date() },
    ]);
    usersService.findByIds.mockResolvedValue([]);

    const result = await service.getOffersForRideAdmin('ride-1');

    expect(result[0].driverName).toBeNull();
  });

  it('returns an empty array for a ride that was never offered to anyone', async () => {
    const { service, offersRepo } = buildService();
    offersRepo.find.mockResolvedValue([]);

    expect(await service.getOffersForRideAdmin('ride-1')).toEqual([]);
  });
});

describe('DispatchService.redispatchForAdmin()', () => {
  it('redispatches a plain SEARCHING ride without needing to touch its status first', async () => {
    const { service, ridesRepo, driversService } = buildService();
    ridesRepo.findOne.mockResolvedValue({ id: 'ride-1', status: 'searching', pickupLat: 6.5, pickupLng: 3.3, city: 'Lagos' });
    driversService.findNearby.mockResolvedValue([{ userId: 'driver-1', distanceKm: 2 }]);

    const offer = await service.redispatchForAdmin('ride-1');

    expect(offer).toBeDefined();
    expect(ridesRepo.update).not.toHaveBeenCalled();
  });

  it('flips a NO_DRIVER_FOUND ride back to SEARCHING before attempting to redispatch it', async () => {
    const { service, ridesRepo, driversService } = buildService();
    ridesRepo.findOne.mockResolvedValue({ id: 'ride-1', status: 'no_driver_found', pickupLat: 6.5, pickupLng: 3.3, city: 'Lagos' });
    driversService.findNearby.mockResolvedValue([{ userId: 'driver-1', distanceKm: 2 }]);

    await service.redispatchForAdmin('ride-1');

    expect(ridesRepo.update).toHaveBeenCalledWith('ride-1', { status: 'searching' });
  });

  it('refuses to redispatch a ride that has already been accepted', async () => {
    const { service, ridesRepo } = buildService();
    ridesRepo.findOne.mockResolvedValue({ id: 'ride-1', status: 'accepted' });

    await expect(service.redispatchForAdmin('ride-1')).rejects.toThrow(BadRequestException);
  });

  it('refuses to redispatch a completed ride', async () => {
    const { service, ridesRepo } = buildService();
    ridesRepo.findOne.mockResolvedValue({ id: 'ride-1', status: 'completed' });

    await expect(service.redispatchForAdmin('ride-1')).rejects.toThrow(BadRequestException);
  });

  it('throws NotFoundException for a ride that does not exist', async () => {
    const { service, ridesRepo } = buildService();
    ridesRepo.findOne.mockResolvedValue(null);

    await expect(service.redispatchForAdmin('missing-ride')).rejects.toThrow(NotFoundException);
  });
});
