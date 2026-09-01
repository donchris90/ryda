import { PoolMatchingService } from './pool-matching.service';
import {
  RideStatus,
  RideCategory,
  PaymentMethod,
} from '../common/enums/ride.enum';
import { DispatchMode } from '../candidate-search/candidate-search.types';
import { PoolGroupStatus } from './entities/pool-group.entity';

function fakeRide(overrides: Partial<any> = {}) {
  return {
    id: 'ride-1',
    passengerId: 'passenger-1',
    status: RideStatus.POOL_MATCHING,
    isPooled: true,
    dispatchMode: DispatchMode.AUTO,
    category: RideCategory.ECONOMY,
    paymentMethod: PaymentMethod.CASH,
    city: 'Lagos',
    pickupLat: 6.5244,
    pickupLng: 3.3792,
    pickupAddress: 'Pickup A',
    dropoffLat: 6.6,
    dropoffLng: 3.4,
    dropoffAddress: 'Dropoff A',
    poolGroupId: null,
    poolDiscountAmount: '0.00',
    totalFare: '1000.00',
    discount: '0.00',
    stops: null,
    createdAt: new Date('2026-09-01T10:00:00Z'),
    ...overrides,
  };
}

const CONFIG_VALUES: Record<string, number> = {
  'pooling.matchWindowMs': 120000,
  'pooling.maxPickupDetourKm': 2,
  'pooling.maxDetourFraction': 0.35,
  'pooling.discountFraction': 0.25,
};

function buildService(overrides: Record<string, any> = {}) {
  const queryBuilder: any = {
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({ affected: 1 }),
  };

  const manager = {
    create: jest.fn((_entity: any, data: any) => data),
    save: jest.fn((data: any) => Promise.resolve({ id: 'group-1', ...data })),
    createQueryBuilder: jest.fn(() => queryBuilder),
  };

  const ridesRepo = {
    findOneOrFail: jest.fn(),
    findOne: jest.fn(),
    find: jest.fn().mockResolvedValue([]),
    save: jest.fn((r: any) => Promise.resolve(r)),
    manager: { transaction: jest.fn((cb: any) => cb(manager)) },
    ...overrides.ridesRepo,
  };

  const poolGroupsRepo = {
    findOne: jest.fn(),
    save: jest.fn((g: any) => Promise.resolve(g)),
    update: jest.fn().mockResolvedValue(undefined),
    ...overrides.poolGroupsRepo,
  };

  const poolMatchingQueue = {
    add: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn().mockResolvedValue(undefined),
    ...overrides.poolMatchingQueue,
  };

  const autoDispatchService = {
    startForRide: jest.fn().mockResolvedValue(undefined),
    ...overrides.autoDispatchService,
  };

  const config = {
    get: jest.fn((key: string) => CONFIG_VALUES[key]),
    ...overrides.config,
  };

  const metrics = {
    rideRequestsTotal: { inc: jest.fn() },
    ...overrides.metrics,
  };

  const service = new PoolMatchingService(
    ridesRepo,
    poolGroupsRepo,
    poolMatchingQueue,
    autoDispatchService,
    config,
    metrics,
  );

  return {
    service,
    ridesRepo,
    poolGroupsRepo,
    poolMatchingQueue,
    autoDispatchService,
    config,
    metrics,
    queryBuilder,
    manager,
  };
}

describe('PoolMatchingService', () => {
  describe('requestPool', () => {
    it('pairs immediately with a compatible waiting ride and dispatches the anchor', async () => {
      const rideA = fakeRide({
        id: 'ride-a',
        createdAt: new Date('2026-09-01T10:00:00Z'),
      });
      const rideB = fakeRide({
        id: 'ride-b',
        createdAt: new Date('2026-09-01T10:00:30Z'),
        pickupLat: 6.525,
        pickupLng: 3.3795,
        pickupAddress: 'Pickup B',
        dropoffLat: 6.61,
        dropoffLng: 3.41,
        dropoffAddress: 'Dropoff B',
      });

      const {
        service,
        ridesRepo,
        poolMatchingQueue,
        autoDispatchService,
        manager,
      } = buildService({
        ridesRepo: {
          findOneOrFail: jest.fn().mockResolvedValue(rideA),
          find: jest.fn().mockResolvedValue([rideA, rideB]),
        },
      });

      await service.requestPool('ride-a');

      // A PoolGroup was created and saved.
      expect(manager.create).toHaveBeenCalled();
      expect(manager.save).toHaveBeenCalled();
      // Both rides were claimed via conditional UPDATE.
      const qb = ridesRepo.manager.transaction.mock.calls; // sanity: transaction was used
      expect(qb.length).toBe(1);
      // No delayed fallback job needed since it matched immediately.
      expect(poolMatchingQueue.add).not.toHaveBeenCalled();
      // The earlier-created ride (anchor) is dispatched.
      expect(autoDispatchService.startForRide).toHaveBeenCalledWith('ride-a');
    });

    it('schedules a delayed fallback job when no compatible partner is waiting', async () => {
      const ride = fakeRide({ id: 'ride-a' });
      const { service, poolMatchingQueue, ridesRepo } = buildService({
        ridesRepo: {
          findOneOrFail: jest.fn().mockResolvedValue(ride),
          find: jest.fn().mockResolvedValue([ride]), // only itself waiting
        },
      });

      await service.requestPool('ride-a');

      expect(poolMatchingQueue.add).toHaveBeenCalledWith(
        'resolve-window',
        { rideId: 'ride-a' },
        { delay: 120000, jobId: 'pool-window-ride-a' },
      );
    });

    it('does not pair rides whose pickups are too far apart', async () => {
      const rideA = fakeRide({ id: 'ride-a' });
      const rideB = fakeRide({
        id: 'ride-b',
        pickupLat: 6.7, // ~20km away — outside maxPickupDetourKm
        pickupLng: 3.3792,
      });

      const { service, poolMatchingQueue } = buildService({
        ridesRepo: {
          findOneOrFail: jest.fn().mockResolvedValue(rideA),
          find: jest.fn().mockResolvedValue([rideA, rideB]),
        },
      });

      await service.requestPool('ride-a');

      expect(poolMatchingQueue.add).toHaveBeenCalled(); // fell back to scheduling the window instead
    });

    it('does not pair rides in different cities', async () => {
      const rideA = fakeRide({ id: 'ride-a', city: 'Lagos' });
      const rideB = fakeRide({
        id: 'ride-b',
        city: 'Abuja',
        pickupLat: 6.525,
        pickupLng: 3.3795,
      });

      const { service, poolMatchingQueue } = buildService({
        ridesRepo: {
          findOneOrFail: jest.fn().mockResolvedValue(rideA),
          find: jest.fn().mockResolvedValue([rideA, rideB]),
        },
      });

      await service.requestPool('ride-a');

      expect(poolMatchingQueue.add).toHaveBeenCalled();
    });
  });

  describe('resolveWindow', () => {
    it('falls back to solo AUTO dispatch when still unmatched after the window', async () => {
      const ride = fakeRide({ id: 'ride-a', status: RideStatus.POOL_MATCHING });
      const { service, ridesRepo, autoDispatchService } = buildService({
        ridesRepo: {
          findOne: jest.fn().mockResolvedValue(ride),
          find: jest.fn().mockResolvedValue([ride]),
          save: jest.fn((r: any) => Promise.resolve(r)),
        },
      });

      await service.resolveWindow('ride-a');

      expect(ridesRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: RideStatus.SEARCHING,
          dispatchMode: DispatchMode.AUTO,
        }),
      );
      expect(autoDispatchService.startForRide).toHaveBeenCalledWith('ride-a');
    });

    it('no-ops if the ride already left POOL_MATCHING by the time the job fires', async () => {
      const ride = fakeRide({ id: 'ride-a', status: RideStatus.SEARCHING });
      const { service, ridesRepo, autoDispatchService } = buildService({
        ridesRepo: { findOne: jest.fn().mockResolvedValue(ride) },
      });

      await service.resolveWindow('ride-a');

      expect(ridesRepo.save).not.toHaveBeenCalled();
      expect(autoDispatchService.startForRide).not.toHaveBeenCalled();
    });
  });

  describe('unpoolRide', () => {
    it('reverts the surviving ride to a solo fare and re-dispatches it', async () => {
      const ride = fakeRide({
        id: 'ride-b',
        status: RideStatus.SEARCHING,
        poolGroupId: 'group-1',
        poolDiscountAmount: '250.00',
        totalFare: '750.00',
        discount: '250.00',
      });

      const { service, ridesRepo, poolGroupsRepo, autoDispatchService } =
        buildService({
          ridesRepo: { findOne: jest.fn().mockResolvedValue(ride) },
        });

      await service.unpoolRide('ride-b', 'partner cancelled');

      expect(ridesRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          poolGroupId: null,
          totalFare: '1000.00',
          discount: '0.00',
          poolDiscountAmount: '0.00',
        }),
      );
      expect(poolGroupsRepo.update).toHaveBeenCalledWith(
        { id: 'group-1' },
        { status: PoolGroupStatus.UNWOUND, unwindReason: 'partner cancelled' },
      );
      expect(autoDispatchService.startForRide).toHaveBeenCalledWith('ride-b');
    });

    it('no-ops for a ride that was never pooled', async () => {
      const ride = fakeRide({ id: 'ride-b', poolGroupId: null });
      const { service, ridesRepo } = buildService({
        ridesRepo: { findOne: jest.fn().mockResolvedValue(ride) },
      });

      await service.unpoolRide('ride-b', 'n/a');

      expect(ridesRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('unpoolRideMidTrip', () => {
    it('settles the surviving passenger back to solo fare, keeping their driver assignment', async () => {
      const cancelledRide = fakeRide({
        id: 'ride-a',
        status: RideStatus.CANCELLED,
        poolGroupId: 'group-1',
        driverId: 'driver-1',
      });
      const survivingRide = fakeRide({
        id: 'ride-b',
        status: RideStatus.IN_PROGRESS,
        poolGroupId: 'group-1',
        driverId: 'driver-1',
        vehicleId: 'vehicle-1',
        poolDiscountAmount: '250.00',
        totalFare: '750.00',
        discount: '250.00',
      });

      const { service, ridesRepo, poolGroupsRepo } = buildService({
        ridesRepo: {
          findOne: jest
            .fn()
            .mockResolvedValueOnce(cancelledRide)
            .mockResolvedValueOnce(survivingRide),
        },
        poolGroupsRepo: {
          findOne: jest.fn().mockResolvedValue({
            id: 'group-1',
            anchorRideId: 'ride-a',
            partnerRideId: 'ride-b',
          }),
        },
      });

      await service.unpoolRideMidTrip('ride-a', 'partner cancelled mid-trip');

      // Fare/discount reverted, driver/vehicle/status (still driving)
      // untouched. Co-rider stop detail lives entirely in getPoolManifest
      // now, which starts returning null for both sides as soon as
      // poolGroupId clears below — there's no separate `stops` field to
      // reset here.
      expect(ridesRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'ride-b',
          poolGroupId: null,
          totalFare: '1000.00',
          discount: '0.00',
          poolDiscountAmount: '0.00',
          status: RideStatus.IN_PROGRESS,
          driverId: 'driver-1',
          vehicleId: 'vehicle-1',
        }),
      );
      expect(poolGroupsRepo.update).toHaveBeenCalledWith(
        { id: 'group-1' },
        {
          status: PoolGroupStatus.UNWOUND,
          unwindReason: 'partner cancelled mid-trip',
        },
      );
    });

    it('no-ops if the surviving partner already completed', async () => {
      const cancelledRide = fakeRide({
        id: 'ride-a',
        status: RideStatus.CANCELLED,
        poolGroupId: 'group-1',
      });
      const survivingRide = fakeRide({
        id: 'ride-b',
        status: RideStatus.COMPLETED,
        poolGroupId: 'group-1',
      });

      const { service, ridesRepo, poolGroupsRepo } = buildService({
        ridesRepo: {
          findOne: jest
            .fn()
            .mockResolvedValueOnce(cancelledRide)
            .mockResolvedValueOnce(survivingRide),
        },
        poolGroupsRepo: {
          findOne: jest.fn().mockResolvedValue({
            id: 'group-1',
            anchorRideId: 'ride-a',
            partnerRideId: 'ride-b',
          }),
        },
      });

      await service.unpoolRideMidTrip('ride-a', 'partner cancelled mid-trip');

      expect(ridesRepo.save).not.toHaveBeenCalled();
      expect(poolGroupsRepo.update).not.toHaveBeenCalled();
    });

    it('no-ops for a ride with no pool group', async () => {
      const ride = fakeRide({ id: 'ride-a', poolGroupId: null });
      const { service, ridesRepo, poolGroupsRepo } = buildService({
        ridesRepo: { findOne: jest.fn().mockResolvedValue(ride) },
      });

      await service.unpoolRideMidTrip('ride-a', 'n/a');

      expect(ridesRepo.save).not.toHaveBeenCalled();
      expect(poolGroupsRepo.update).not.toHaveBeenCalled();
    });
  });

  describe('propagateDriverAssignment', () => {
    it('assigns the anchor ride’s driver/vehicle onto the still-searching partner', async () => {
      const anchorRide = fakeRide({
        id: 'ride-a',
        poolGroupId: 'group-1',
        driverId: 'driver-1',
        vehicleId: 'vehicle-1',
        acceptedAt: new Date('2026-09-01T10:05:00Z'),
      });
      const partnerRide = fakeRide({
        id: 'ride-b',
        status: RideStatus.SEARCHING,
        poolGroupId: 'group-1',
      });

      const { service, ridesRepo, poolGroupsRepo } = buildService({
        ridesRepo: { findOne: jest.fn().mockResolvedValue(partnerRide) },
        poolGroupsRepo: {
          findOne: jest.fn().mockResolvedValue({
            id: 'group-1',
            anchorRideId: 'ride-a',
            partnerRideId: 'ride-b',
          }),
        },
      });

      await service.propagateDriverAssignment(anchorRide as any);

      expect(ridesRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'ride-b',
          driverId: 'driver-1',
          vehicleId: 'vehicle-1',
          status: RideStatus.ACCEPTED,
        }),
      );
      expect(poolGroupsRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: PoolGroupStatus.DISPATCHED }),
      );
    });

    it('does nothing if the partner already left SEARCHING (e.g. cancelled)', async () => {
      const anchorRide = fakeRide({
        id: 'ride-a',
        poolGroupId: 'group-1',
        driverId: 'driver-1',
      });
      const partnerRide = fakeRide({
        id: 'ride-b',
        status: RideStatus.CANCELLED,
        poolGroupId: 'group-1',
      });

      const { service, ridesRepo } = buildService({
        ridesRepo: { findOne: jest.fn().mockResolvedValue(partnerRide) },
        poolGroupsRepo: {
          findOne: jest.fn().mockResolvedValue({
            id: 'group-1',
            anchorRideId: 'ride-a',
            partnerRideId: 'ride-b',
          }),
        },
      });

      await service.propagateDriverAssignment(anchorRide as any);

      expect(ridesRepo.save).not.toHaveBeenCalled();
    });
  });
});
