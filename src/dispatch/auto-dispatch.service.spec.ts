import { AutoDispatchService } from './auto-dispatch.service';
import { RideStatus, RideCategory, PaymentMethod } from '../common/enums/ride.enum';
import { DispatchDomain, DispatchMode } from '../candidate-search/candidate-search.types';
import { DriverLevel } from '../common/enums/driver-level.enum';
import { VehicleCategory } from '../common/enums/vehicle.enum';
import { EtaSource } from '../ranking/ranking.types';

function fakeRide(overrides: Partial<any> = {}) {
  return {
    id: 'ride-1',
    passengerId: 'passenger-1',
    status: RideStatus.SEARCHING,
    dispatchMode: DispatchMode.AUTO,
    pickupLat: 6.5244,
    pickupLng: 3.3792,
    category: RideCategory.ECONOMY,
    paymentMethod: PaymentMethod.CARD,
    city: 'Lagos',
    ...overrides,
  };
}

function fakeCandidate(overrides: Partial<any> = {}) {
  return {
    driverUserId: 'driver-1',
    driverProfileId: 'profile-1',
    vehicleId: 'vehicle-1',
    vehicleCategory: VehicleCategory.CAR,
    lat: 6.5244,
    lng: 3.3792,
    distanceKm: 2,
    rating: 4.8,
    level: DriverLevel.STANDARD,
    ...overrides,
  };
}

function fakeRanked(overrides: Partial<any> = {}) {
  return { ...fakeCandidate(), etaMinutes: 5, etaSource: EtaSource.ROUTING, ...overrides };
}

/**
 * Direct-construction style, matching the rest of this codebase's service
 * specs (e.g. rides.service.manual-dispatch.spec.ts) rather than pulling
 * in the full Nest Testing module.
 */
function buildService(overrides: Record<string, any> = {}) {
  const queryBuilder: any = {
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({ affected: 1 }),
  };

  const ridesRepo = {
    findOne: jest.fn().mockResolvedValue(fakeRide()),
    createQueryBuilder: jest.fn(() => queryBuilder),
    __queryBuilder: queryBuilder,
    ...overrides.ridesRepo,
  };

  const candidateSearchService = {
    search: jest.fn().mockResolvedValue({
      candidates: [fakeCandidate()],
      radiusUsedKm: 8,
      roundsAttempted: 1,
    }),
    ...overrides.candidateSearchService,
  };

  const driverRankingService = {
    rank: jest.fn().mockResolvedValue({
      ranked: [fakeRanked()],
      routingCallsMade: 1,
      routingFailures: 0,
      fallbackUsed: false,
    }),
    ...overrides.driverRankingService,
  };

  const dispatchService = {
    offerToSpecificDriver: jest.fn().mockResolvedValue(undefined),
    getPendingOfferForRide: jest.fn().mockResolvedValue(null),
    getTriedDriverUserIds: jest.fn().mockResolvedValue([]),
    ...overrides.dispatchService,
  };

  const config = {
    get: jest.fn((key: string) => {
      const values: Record<string, number> = {
        'dispatch.initialRadiusKm': 8,
        'dispatch.maxRadiusKm': 15,
        'dispatch.candidateFetchLimit': 50,
      };
      return values[key];
    }),
    ...overrides.config,
  };

  const metrics = {
    autoDispatchOffersTotal: { inc: jest.fn() },
    autoDispatchReassignmentsTotal: { inc: jest.fn() },
    autoDispatchNoDriverFoundTotal: { inc: jest.fn() },
    autoDispatchRadiusExpansionTotal: { inc: jest.fn() },
    ...overrides.metrics,
  };

  const events = { emit: jest.fn(), ...overrides.events };

  const airportService = {
    findContainingAirport: jest.fn().mockResolvedValue(null),
    dispatchNext: jest.fn().mockResolvedValue(null),
    ...overrides.airportService,
  };

  const driversService = {
    findByUserId: jest.fn().mockResolvedValue({ availability: 'online_for_rides' }),
    ...overrides.driversService,
  };

  const service = new AutoDispatchService(
    ridesRepo as any,
    candidateSearchService as any,
    driverRankingService as any,
    dispatchService as any,
    config as any,
    metrics as any,
    events as any,
    airportService as any,
    driversService as any,
  );

  return { service, ridesRepo, candidateSearchService, driverRankingService, dispatchService, config, metrics, events, airportService, driversService };
}

describe('AutoDispatchService', () => {
  describe('startForRide', () => {
    it('offers the ride to the best-ranked eligible candidate found by the shared pipeline', async () => {
      const { service, candidateSearchService, driverRankingService, dispatchService, metrics } = buildService();

      await service.startForRide('ride-1');

      expect(candidateSearchService.search).toHaveBeenCalledWith(
        expect.objectContaining({
          pickup: { lat: 6.5244, lng: 3.3792 },
          domain: DispatchDomain.RIDE,
          mode: DispatchMode.AUTO,
          rideCategory: RideCategory.ECONOMY,
          excludeDriverUserIds: [],
          minCandidates: 1,
        }),
      );
      expect(driverRankingService.rank).toHaveBeenCalledWith({ lat: 6.5244, lng: 3.3792 }, [fakeCandidate()]);
      expect(dispatchService.offerToSpecificDriver).toHaveBeenCalledWith('ride-1', 'driver-1', 2);
      expect(metrics.autoDispatchOffersTotal.inc).toHaveBeenCalledTimes(1);
    });

    it('never offers to a driver already tried for this ride — passes the exclude list from DispatchService', async () => {
      const { service, candidateSearchService, dispatchService } = buildService({
        dispatchService: { getTriedDriverUserIds: jest.fn().mockResolvedValue(['driver-0', 'driver-1']) },
      });

      await service.startForRide('ride-1');

      expect(candidateSearchService.search).toHaveBeenCalledWith(
        expect.objectContaining({ excludeDriverUserIds: ['driver-0', 'driver-1'] }),
      );
      // Even though the mocked search still returns driver-1 here (the mock
      // doesn't actually filter), the real CandidateSearchService is what's
      // responsible for honoring excludeDriverUserIds — this test only
      // verifies AutoDispatchService always passes the full tried-list
      // through, not that it re-filters results itself.
      expect(dispatchService.offerToSpecificDriver).toHaveBeenCalled();
    });

    it('is a no-op if the ride is not SEARCHING', async () => {
      const { service, ridesRepo, dispatchService, candidateSearchService } = buildService({
        ridesRepo: { findOne: jest.fn().mockResolvedValue(fakeRide({ status: RideStatus.ACCEPTED })) },
      });

      await service.startForRide('ride-1');

      expect(candidateSearchService.search).not.toHaveBeenCalled();
      expect(dispatchService.offerToSpecificDriver).not.toHaveBeenCalled();
    });

    it('is a no-op for a MANUAL ride', async () => {
      const { service, dispatchService, candidateSearchService } = buildService({
        ridesRepo: { findOne: jest.fn().mockResolvedValue(fakeRide({ dispatchMode: DispatchMode.MANUAL })) },
      });

      await service.startForRide('ride-1');

      expect(candidateSearchService.search).not.toHaveBeenCalled();
      expect(dispatchService.offerToSpecificDriver).not.toHaveBeenCalled();
    });

    it('does not create a second offer if one is already pending (guards a decline/timeout race)', async () => {
      const { service, dispatchService, candidateSearchService } = buildService({
        dispatchService: {
          getPendingOfferForRide: jest.fn().mockResolvedValue({ id: 'offer-1', driverUserId: 'driver-1' }),
        },
      });

      await service.startForRide('ride-1');

      expect(candidateSearchService.search).not.toHaveBeenCalled();
      expect(dispatchService.offerToSpecificDriver).not.toHaveBeenCalled();
    });

    it('marks the ride NO_DRIVER_FOUND once the candidate pool is exhausted at max radius', async () => {
      const { service, ridesRepo, dispatchService, metrics } = buildService({
        candidateSearchService: {
          search: jest.fn().mockResolvedValue({ candidates: [], radiusUsedKm: 15, roundsAttempted: 3 }),
        },
      });

      await service.startForRide('ride-1');

      expect(dispatchService.offerToSpecificDriver).not.toHaveBeenCalled();
      expect(ridesRepo.__queryBuilder.update).toHaveBeenCalled();
      expect(ridesRepo.__queryBuilder.set).toHaveBeenCalledWith({ status: RideStatus.NO_DRIVER_FOUND });
      expect(ridesRepo.__queryBuilder.where).toHaveBeenCalledWith('id = :id', { id: 'ride-1' });
      expect(ridesRepo.__queryBuilder.andWhere).toHaveBeenCalledWith('status = :searching', {
        searching: RideStatus.SEARCHING,
      });
      expect(metrics.autoDispatchNoDriverFoundTotal.inc).toHaveBeenCalledTimes(1);
    });

    it('does NOT mark NO_DRIVER_FOUND when the empty round has not yet reached max radius', async () => {
      const { service, ridesRepo, metrics } = buildService({
        candidateSearchService: {
          search: jest.fn().mockResolvedValue({ candidates: [], radiusUsedKm: 8, roundsAttempted: 1 }),
        },
      });

      await service.startForRide('ride-1');

      expect(ridesRepo.__queryBuilder.update).not.toHaveBeenCalled();
      expect(metrics.autoDispatchNoDriverFoundTotal.inc).not.toHaveBeenCalled();
    });

    it('counts a radius-expansion metric when the winning round searched beyond the initial radius', async () => {
      const { service, metrics } = buildService({
        candidateSearchService: {
          search: jest.fn().mockResolvedValue({ candidates: [fakeCandidate()], radiusUsedKm: 12, roundsAttempted: 2 }),
        },
      });

      await service.startForRide('ride-1');

      expect(metrics.autoDispatchRadiusExpansionTotal.inc).toHaveBeenCalledTimes(1);
    });

    it('does not crash the caller if the pipeline throws — logs and leaves the ride SEARCHING', async () => {
      const { service, dispatchService } = buildService({
        candidateSearchService: { search: jest.fn().mockRejectedValue(new Error('redis down')) },
      });

      await expect(service.startForRide('ride-1')).resolves.toBeUndefined();
      expect(dispatchService.offerToSpecificDriver).not.toHaveBeenCalled();
    });
  });

  describe('decline handling', () => {
    it('offers to the next candidate when a driver declines an AUTO ride', async () => {
      const { service, candidateSearchService, dispatchService, metrics } = buildService();

      await service.onOfferDeclined({ rideId: 'ride-1', driverUserId: 'driver-1' });

      expect(candidateSearchService.search).toHaveBeenCalled();
      expect(dispatchService.offerToSpecificDriver).toHaveBeenCalledWith('ride-1', 'driver-1', 2);
      expect(metrics.autoDispatchReassignmentsTotal.inc).toHaveBeenCalledWith({ reason: 'declined' });
    });

    it('ignores a decline for a MANUAL ride', async () => {
      const { service, candidateSearchService } = buildService({
        ridesRepo: { findOne: jest.fn().mockResolvedValue(fakeRide({ dispatchMode: DispatchMode.MANUAL })) },
      });

      await service.onOfferDeclined({ rideId: 'ride-1', driverUserId: 'driver-1' });

      expect(candidateSearchService.search).not.toHaveBeenCalled();
    });
  });

  describe('timeout handling', () => {
    it('offers to the next candidate when an AUTO ride offer expires', async () => {
      const { service, candidateSearchService, dispatchService, metrics } = buildService();

      await service.onOfferExpired({ rideId: 'ride-1', driverUserId: 'driver-1' });

      expect(candidateSearchService.search).toHaveBeenCalled();
      expect(dispatchService.offerToSpecificDriver).toHaveBeenCalledWith('ride-1', 'driver-1', 2);
      expect(metrics.autoDispatchReassignmentsTotal.inc).toHaveBeenCalledWith({ reason: 'expired' });
    });

    it('ignores an expiry for a MANUAL ride (no silent reassignment)', async () => {
      const { service, candidateSearchService } = buildService({
        ridesRepo: { findOne: jest.fn().mockResolvedValue(fakeRide({ dispatchMode: DispatchMode.MANUAL })) },
      });

      await service.onOfferExpired({ rideId: 'ride-1', driverUserId: 'driver-1' });

      expect(candidateSearchService.search).not.toHaveBeenCalled();
    });
  });

  describe('deterministic ranking hand-off', () => {
    it('always offers to ranked[0], not just the first raw candidate', async () => {
      const { service, dispatchService } = buildService({
        candidateSearchService: {
          search: jest.fn().mockResolvedValue({
            candidates: [fakeCandidate({ driverUserId: 'driver-far', distanceKm: 5 }), fakeCandidate({ driverUserId: 'driver-near', distanceKm: 1 })],
            radiusUsedKm: 8,
            roundsAttempted: 1,
          }),
        },
        driverRankingService: {
          // Ranking layer decided driver-near wins on ETA — even though it
          // wasn't first in the raw candidate list.
          rank: jest.fn().mockResolvedValue({
            ranked: [
              fakeRanked({ driverUserId: 'driver-near', distanceKm: 1, etaMinutes: 3 }),
              fakeRanked({ driverUserId: 'driver-far', distanceKm: 5, etaMinutes: 9 }),
            ],
            routingCallsMade: 2,
            routingFailures: 0,
            fallbackUsed: false,
          }),
        },
      });

      await service.startForRide('ride-1');

      expect(dispatchService.offerToSpecificDriver).toHaveBeenCalledWith('ride-1', 'driver-near', 1);
    });
  });

  describe('airport queue dispatch - connecting the airport driver queue to real dispatch', () => {
    it('offers the ride to the front of the airport queue and skips the normal nearest-driver search entirely', async () => {
      const { service, airportService, candidateSearchService, dispatchService } = buildService({
        airportService: {
          findContainingAirport: jest.fn().mockResolvedValue({ id: 'airport-1', iataCode: 'LOS' }),
          dispatchNext: jest.fn().mockResolvedValue({ driverUserId: 'queue-driver-1' }),
        },
      });

      await service.startForRide('ride-1');

      expect(dispatchService.offerToSpecificDriver).toHaveBeenCalledWith('ride-1', 'queue-driver-1', 0);
      expect(candidateSearchService.search).not.toHaveBeenCalled();
      expect(airportService.dispatchNext).toHaveBeenCalledWith('airport-1', RideCategory.ECONOMY);
    });

    it('passes this specific ride\'s category through to dispatchNext(), not just a fixed default', async () => {
      const { service, airportService } = buildService({
        airportService: {
          findContainingAirport: jest.fn().mockResolvedValue({ id: 'airport-1', iataCode: 'LOS' }),
          dispatchNext: jest.fn().mockResolvedValue({ driverUserId: 'queue-driver-1' }),
        },
        ridesRepo: { findOne: jest.fn().mockResolvedValue(fakeRide({ category: RideCategory.COMFORT })) },
      });

      await service.startForRide('ride-1');

      expect(airportService.dispatchNext).toHaveBeenCalledWith('airport-1', RideCategory.COMFORT);
    });

    it('falls through to the normal search when the pickup is not inside any airport geofence', async () => {
      const { service, candidateSearchService, dispatchService } = buildService({
        airportService: { findContainingAirport: jest.fn().mockResolvedValue(null) },
      });

      await service.startForRide('ride-1');

      expect(candidateSearchService.search).toHaveBeenCalled();
      expect(dispatchService.offerToSpecificDriver).toHaveBeenCalledWith('ride-1', 'driver-1', 2); // normal search's fakeCandidate
    });

    it('falls through to the normal search when the airport queue is genuinely empty, rather than blocking dispatch', async () => {
      const { service, candidateSearchService } = buildService({
        airportService: {
          findContainingAirport: jest.fn().mockResolvedValue({ id: 'airport-1', iataCode: 'LOS' }),
          dispatchNext: jest.fn().mockResolvedValue(null),
        },
      });

      await service.startForRide('ride-1');

      expect(candidateSearchService.search).toHaveBeenCalled();
    });

    it('self-heals past a queued driver who went offline without formally leaving the queue', async () => {
      const { service, driversService, dispatchService } = buildService({
        airportService: {
          findContainingAirport: jest.fn().mockResolvedValue({ id: 'airport-1', iataCode: 'LOS' }),
          dispatchNext: jest
            .fn()
            .mockResolvedValueOnce({ driverUserId: 'now-offline-driver' })
            .mockResolvedValueOnce({ driverUserId: 'genuinely-online-driver' }),
        },
        driversService: {
          findByUserId: jest.fn((userId: string) =>
            Promise.resolve({
              availability: userId === 'now-offline-driver' ? 'offline' : 'online_for_rides',
            }),
          ),
        },
      });

      await service.startForRide('ride-1');

      expect(driversService.findByUserId).toHaveBeenCalledWith('now-offline-driver');
      expect(driversService.findByUserId).toHaveBeenCalledWith('genuinely-online-driver');
      expect(dispatchService.offerToSpecificDriver).toHaveBeenCalledWith('ride-1', 'genuinely-online-driver', 0);
    });
  });
});
