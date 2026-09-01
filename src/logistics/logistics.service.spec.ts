import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { LogisticsService } from './logistics.service';
import { DeliveryOrder, DeliveryStatus, DeliveryVehicleType, DeliveryCategory } from './entities/delivery-order.entity';
import { PaymentMethod } from '../common/enums/ride.enum';
import { DriverApprovalStatus, DriverAvailability } from '../common/enums/driver-status.enum';
import { DriverService } from '../common/enums/driver-service.enum';
import { VehicleCategory } from '../common/enums/vehicle.enum';
import { DispatchDomain } from '../candidate-search/candidate-search.types';
import { UserRole } from '../common/enums/user-role.enum';

function fakeOrder(overrides: Partial<DeliveryOrder> = {}): DeliveryOrder {
  return {
    id: 'order-1',
    customerId: 'customer-1',
    driverId: null,
    vehicleId: null,
    category: DeliveryCategory.PARCEL,
    vehicleType: DeliveryVehicleType.CAR,
    status: DeliveryStatus.SEARCHING,
    pickupLat: 6.5244,
    pickupLng: 3.3792,
    pickupAddress: '1 Pickup St',
    dropoffLat: 6.44,
    dropoffLng: 3.42,
    dropoffAddress: '2 Dropoff St',
    totalFare: '2500.00',
    paymentMethod: PaymentMethod.CASH,
    ...overrides,
  } as DeliveryOrder;
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
    level: 'standard',
    ...overrides,
  };
}

function buildService(overrides: Record<string, any> = {}) {
  const ordersRepo = {
    create: jest.fn((data) => data),
    save: jest.fn(async (data) => ({ id: 'order-1', ...data })),
    findOne: jest.fn(),
    find: jest.fn().mockResolvedValue([]),
    manager: {
      transaction: jest.fn(async (cb: any) => cb(overrides.manager ?? {})),
    },
    ...overrides.ordersRepo,
  };

  const deps = {
    ordersRepo,
    config: { get: jest.fn() },
    driversService: {
      findByUserId: jest.fn(),
      reserveOnlineDriverForTrip: jest.fn(),
      emitReservedForTrip: jest.fn(),
      recordTripOutcome: jest.fn(),
      setAvailability: jest.fn(),
      ...overrides.driversService,
    },
    vehiclesService: { findById: jest.fn(), ...overrides.vehiclesService },
    walletsService: { ...overrides.walletsService },
    commissionService: { ...overrides.commissionService },
    corporateService: { ...overrides.corporateService },
    fleetService: { ...overrides.fleetService },
    usersService: { ...overrides.usersService },
    paymentsService: { ...overrides.paymentsService },
    reconciliationService: { ...overrides.reconciliationService },
    settingsService: { getNumber: jest.fn().mockResolvedValue(0) },
    vehicleTypesService: {
      getByType: jest.fn().mockResolvedValue({
        maxWeightKg: '1000',
        baseFare: '500',
        perKm: '100',
        perKg: '10',
        minimumFare: '500',
      }),
      ...overrides.vehicleTypesService,
    },
    candidateSearchService: { search: jest.fn(), ...overrides.candidateSearchService },
    driverRankingService: { rank: jest.fn(), ...overrides.driverRankingService },
    events: { emit: jest.fn(), ...overrides.events },
    metrics: {
      courierDispatchNoDriverFoundTotal: { inc: jest.fn() },
      ...overrides.metrics,
    },
    promotionsService: {
      grantReferralBonusIfEligible: jest.fn(),
      ...overrides.promotionsService,
    },
  };

  const service = new LogisticsService(
    deps.ordersRepo as any,
    deps.config as any,
    deps.driversService as any,
    deps.vehiclesService as any,
    deps.walletsService as any,
    deps.commissionService as any,
    deps.corporateService as any,
    deps.fleetService as any,
    deps.usersService as any,
    deps.paymentsService as any,
    deps.reconciliationService as any,
    deps.settingsService as any,
    deps.vehicleTypesService as any,
    deps.candidateSearchService as any,
    deps.driverRankingService as any,
    deps.events as any,
    deps.metrics as any,
    deps.promotionsService as any,
  );

  return { service, deps };
}

const REQUEST_DTO = {
  category: DeliveryCategory.PARCEL,
  vehicleType: DeliveryVehicleType.CAR,
  pickupLat: 6.5244,
  pickupLng: 3.3792,
  pickupAddress: '1 Pickup St',
  dropoffLat: 6.44,
  dropoffLng: 3.42,
  dropoffAddress: '2 Dropoff St',
  paymentMethod: PaymentMethod.CASH,
};

describe('LogisticsService — courier matching via the shared pipeline', () => {
  describe('requestDelivery', () => {
    it('notifies an online, eligible driver found by the shared candidate engine', async () => {
      const { service, deps } = buildService();
      deps.candidateSearchService.search.mockResolvedValue({
        candidates: [fakeCandidate({ driverUserId: 'driver-online' })],
        radiusUsedKm: 8,
        roundsAttempted: 1,
      });
      deps.driverRankingService.rank.mockResolvedValue({
        ranked: [{ ...fakeCandidate({ driverUserId: 'driver-online' }), etaMinutes: 5 }],
        routingCallsMade: 1,
        routingFailures: 0,
        fallbackUsed: false,
      });

      await service.requestDelivery('customer-1', REQUEST_DTO as any);

      expect(deps.candidateSearchService.search).toHaveBeenCalledWith(
        expect.objectContaining({ domain: DispatchDomain.COURIER, deliveryVehicleType: DeliveryVehicleType.CAR }),
      );
      expect(deps.events.emit).toHaveBeenCalledWith(
        'delivery.requested',
        expect.objectContaining({ driverUserIds: ['driver-online'] }),
      );
    });

    it('never scans PostgreSQL directly for nearby drivers — discovery goes entirely through the shared candidate engine', async () => {
      const { service, deps } = buildService();
      deps.candidateSearchService.search.mockResolvedValue({ candidates: [], radiusUsedKm: 15, roundsAttempted: 3 });

      await service.requestDelivery('customer-1', REQUEST_DTO as any);

      expect(deps.driversService.findByUserId).not.toHaveBeenCalled();
      expect(deps.events.emit).not.toHaveBeenCalledWith('delivery.requested', expect.anything());
    });

    it('does not emit a notification when no eligible candidates are found (e.g. incompatible vehicle, on-trip, or stale GPS — all excluded upstream by the shared engine)', async () => {
      const { service, deps } = buildService();
      deps.candidateSearchService.search.mockResolvedValue({ candidates: [], radiusUsedKm: 15, roundsAttempted: 3 });

      await service.requestDelivery('customer-1', REQUEST_DTO as any);

      expect(deps.driverRankingService.rank).not.toHaveBeenCalled();
      expect(deps.events.emit).not.toHaveBeenCalled();
    });

    it('orders notified drivers by best ETA first', async () => {
      const { service, deps } = buildService();
      deps.candidateSearchService.search.mockResolvedValue({
        candidates: [fakeCandidate({ driverUserId: 'far' }), fakeCandidate({ driverUserId: 'near' })],
        radiusUsedKm: 8,
        roundsAttempted: 1,
      });
      deps.driverRankingService.rank.mockResolvedValue({
        ranked: [
          { ...fakeCandidate({ driverUserId: 'near' }), etaMinutes: 3 },
          { ...fakeCandidate({ driverUserId: 'far' }), etaMinutes: 9 },
        ],
        routingCallsMade: 2,
        routingFailures: 0,
        fallbackUsed: false,
      });

      await service.requestDelivery('customer-1', REQUEST_DTO as any);

      expect(deps.events.emit).toHaveBeenCalledWith(
        'delivery.requested',
        expect.objectContaining({ driverUserIds: ['near', 'far'] }),
      );
    });

    it('courier_no_driver_rate (batch 9): increments the no-driver metric when the shared engine finds nobody eligible', async () => {
      const { service, deps } = buildService();
      deps.candidateSearchService.search.mockResolvedValue({ candidates: [], radiusUsedKm: 15, roundsAttempted: 3 });

      await service.requestDelivery('customer-1', REQUEST_DTO as any);

      expect(deps.metrics.courierDispatchNoDriverFoundTotal.inc).toHaveBeenCalledTimes(1);
    });

    it('does not increment the no-driver metric when at least one eligible candidate was found', async () => {
      const { service, deps } = buildService();
      deps.candidateSearchService.search.mockResolvedValue({
        candidates: [fakeCandidate({ driverUserId: 'driver-online' })],
        radiusUsedKm: 8,
        roundsAttempted: 1,
      });
      deps.driverRankingService.rank.mockResolvedValue({
        ranked: [{ ...fakeCandidate({ driverUserId: 'driver-online' }), etaMinutes: 5 }],
        routingCallsMade: 1,
        routingFailures: 0,
        fallbackUsed: false,
      });

      await service.requestDelivery('customer-1', REQUEST_DTO as any);

      expect(deps.metrics.courierDispatchNoDriverFoundTotal.inc).not.toHaveBeenCalled();
    });
  });

  describe('acceptDelivery — atomic driver reservation', () => {
    function fakeManager(overrides: Partial<any> = {}) {
      const queryBuilder: any = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      };
      return {
        createQueryBuilder: jest.fn(() => queryBuilder),
        findOneOrFail: jest.fn().mockResolvedValue(fakeOrder({ status: DeliveryStatus.ACCEPTED })),
        __queryBuilder: queryBuilder,
        ...overrides,
      };
    }

    function baseDeps(manager: any) {
      return {
        manager,
        driversService: {
          findByUserId: jest.fn().mockResolvedValue({
            approvalStatus: DriverApprovalStatus.APPROVED,
            availability: DriverAvailability.ONLINE_FOR_DELIVERIES,
            activeVehicleId: 'vehicle-1',
          }),
          reserveOnlineDriverForTrip: jest.fn().mockResolvedValue({
            userId: 'driver-1',
            id: 'profile-1',
            activeVehicleId: 'vehicle-1',
          }),
          emitReservedForTrip: jest.fn(),
        },
        vehiclesService: {
          findById: jest.fn().mockResolvedValue({ id: 'vehicle-1', category: VehicleCategory.CAR }),
        },
      };
    }

    it('a driver can be assigned to a delivery via the atomic reservation', async () => {
      const manager = fakeManager();
      const { service, deps } = buildService(baseDeps(manager));
      deps.ordersRepo.findOne.mockResolvedValue(fakeOrder());

      const result = await service.acceptDelivery('order-1', 'driver-1');

      expect(deps.driversService.reserveOnlineDriverForTrip).toHaveBeenCalledWith(manager, 'driver-1', DriverService.DELIVERY);
      expect(deps.driversService.emitReservedForTrip).toHaveBeenCalledTimes(1);
      expect(result.status).toBe(DeliveryStatus.ACCEPTED);
    });

    it('rejects an incompatible vehicle before ever opening a transaction', async () => {
      const manager = fakeManager();
      const deps = baseDeps(manager);
      deps.vehiclesService.findById = jest.fn().mockResolvedValue({ id: 'vehicle-1', category: VehicleCategory.MOTORCYCLE });

      const { service, deps: allDeps } = buildService(deps);
      allDeps.ordersRepo.findOne.mockResolvedValue(fakeOrder({ vehicleType: DeliveryVehicleType.VAN }));

      await expect(service.acceptDelivery('order-1', 'driver-1')).rejects.toThrow(BadRequestException);
      expect(allDeps.ordersRepo.manager.transaction).not.toHaveBeenCalled();
    });

    it('rejects an unapproved driver before opening a transaction', async () => {
      const manager = fakeManager();
      const deps = baseDeps(manager);
      deps.driversService.findByUserId = jest.fn().mockResolvedValue({
        approvalStatus: DriverApprovalStatus.PENDING,
        availability: DriverAvailability.ONLINE_FOR_DELIVERIES,
        activeVehicleId: 'vehicle-1',
      });

      const { service, deps: allDeps } = buildService(deps);
      allDeps.ordersRepo.findOne.mockResolvedValue(fakeOrder());

      await expect(service.acceptDelivery('order-1', 'driver-1')).rejects.toThrow(ForbiddenException);
    });

    it('rolls back cleanly when the delivery was already claimed by another driver, even though the reservation itself succeeded', async () => {
      const manager = fakeManager();
      manager.__queryBuilder.execute.mockResolvedValue({ affected: 0 });
      const deps = baseDeps(manager);

      const { service, deps: allDeps } = buildService(deps);
      allDeps.ordersRepo.findOne.mockResolvedValue(fakeOrder());

      await expect(service.acceptDelivery('order-1', 'driver-1')).rejects.toThrow(
        'This delivery was just accepted by another driver.',
      );
      expect(allDeps.driversService.emitReservedForTrip).not.toHaveBeenCalled();
    });

    it('a driver already reserved for a ride cannot simultaneously be accepted onto a delivery — the shared reservation method rejects it', async () => {
      const manager = fakeManager();
      const deps = baseDeps(manager);
      // Simulates reserveOnlineDriverForTrip's real behavior: the driver
      // is no longer ONLINE (a ride's acceptRide() already reserved
      // them), so the conditional UPDATE this delivery relies on matches
      // nothing and the same method used by rides rejects it here too.
      deps.driversService.reserveOnlineDriverForTrip = jest
        .fn()
        .mockRejectedValue(new BadRequestException('Driver is no longer available — they may already be on another trip.'));

      const { service, deps: allDeps } = buildService(deps);
      allDeps.ordersRepo.findOne.mockResolvedValue(fakeOrder());

      await expect(service.acceptDelivery('order-1', 'driver-1')).rejects.toThrow(BadRequestException);
      expect(manager.createQueryBuilder).not.toHaveBeenCalled();
      expect(allDeps.driversService.emitReservedForTrip).not.toHaveBeenCalled();
    });

    it('two concurrent acceptDelivery calls for the same driver: only one can win the reservation', async () => {
      const manager1 = fakeManager();
      const manager2 = fakeManager();
      let reserved = false;
      const reserveOnlineDriverForTrip = jest.fn(async () => {
        if (reserved) {
          throw new BadRequestException('Driver is no longer available — they may already be on another trip.');
        }
        reserved = true;
        return { userId: 'driver-1', id: 'profile-1', activeVehicleId: 'vehicle-1' };
      });

      const sharedDriversService = {
        findByUserId: jest.fn().mockResolvedValue({
          approvalStatus: DriverApprovalStatus.APPROVED,
          availability: DriverAvailability.ONLINE_FOR_DELIVERIES,
          activeVehicleId: 'vehicle-1',
        }),
        reserveOnlineDriverForTrip,
        emitReservedForTrip: jest.fn(),
      };
      const sharedVehiclesService = { findById: jest.fn().mockResolvedValue({ id: 'vehicle-1', category: VehicleCategory.CAR }) };

      const { service: serviceA, deps: depsA } = buildService({
        manager: manager1,
        driversService: sharedDriversService,
        vehiclesService: sharedVehiclesService,
      });
      depsA.ordersRepo.findOne.mockResolvedValue(fakeOrder({ id: 'order-a' }));

      const { service: serviceB, deps: depsB } = buildService({
        manager: manager2,
        driversService: sharedDriversService,
        vehiclesService: sharedVehiclesService,
      });
      depsB.ordersRepo.findOne.mockResolvedValue(fakeOrder({ id: 'order-b' }));

      const [resultA, resultB] = await Promise.allSettled([
        serviceA.acceptDelivery('order-a', 'driver-1'),
        serviceB.acceptDelivery('order-b', 'driver-1'),
      ]);

      const outcomes = [resultA.status, resultB.status];
      expect(outcomes.filter((s) => s === 'fulfilled')).toHaveLength(1);
      expect(outcomes.filter((s) => s === 'rejected')).toHaveLength(1);
    });
  });

  describe('cancelDelivery — atomic cancellation claim (batch 9)', () => {
    function buildServiceWithQueryBuilder(execResult: { affected: number } = { affected: 1 }) {
      const queryBuilder: any = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue(execResult),
      };
      const built = buildService({
        ordersRepo: { createQueryBuilder: jest.fn(() => queryBuilder) },
      });
      return { ...built, queryBuilder };
    }

    it('claims the cancellation via a conditional UPDATE scoped to the order id and the status just read', async () => {
      const { service, deps, queryBuilder } = buildServiceWithQueryBuilder();
      deps.ordersRepo.findOne.mockResolvedValue(fakeOrder({ status: DeliveryStatus.SEARCHING }));

      await service.cancelDelivery('order-1', 'customer-1', 'customer' as any, {});

      expect(queryBuilder.where).toHaveBeenCalledWith('id = :id', { id: 'order-1' });
      expect(queryBuilder.andWhere).toHaveBeenCalledWith('status = :originalStatus', {
        originalStatus: DeliveryStatus.SEARCHING,
      });
    });

    it('throws and does not touch driver state when the delivery changed status underneath it (e.g. a concurrent acceptDelivery won first)', async () => {
      const { service, deps } = buildServiceWithQueryBuilder({ affected: 0 });
      deps.ordersRepo.findOne.mockResolvedValue(
        fakeOrder({ status: DeliveryStatus.SEARCHING, driverId: 'driver-1' }),
      );

      await expect(
        service.cancelDelivery('order-1', 'customer-1', 'customer' as any, {}),
      ).rejects.toThrow(BadRequestException);

      // The original bug: a losing cancel attempt must never put the
      // driver acceptDelivery() just reserved back ONLINE, and must
      // never fire the cancellation event for a cancellation that
      // didn't actually happen.
      expect(deps.driversService.setAvailability).not.toHaveBeenCalled();
      expect(deps.events.emit).not.toHaveBeenCalled();
    });

    it('two concurrent cancelDelivery calls for the same order: only one can win the atomic claim', async () => {
      let currentStatus: DeliveryStatus = DeliveryStatus.SEARCHING;
      let claims = 0;

      const sharedQueryBuilder: any = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn(function (this: any, _clause: string, params: { originalStatus: DeliveryStatus }) {
          this.__expectedStatus = params.originalStatus;
          return this;
        }),
        execute: jest.fn(async function (this: any) {
          if (currentStatus === this.__expectedStatus) {
            currentStatus = DeliveryStatus.CANCELLED;
            claims += 1;
            return { affected: 1 };
          }
          return { affected: 0 };
        }),
      };

      const buildRacer = () =>
        buildService({
          ordersRepo: {
            findOne: jest.fn().mockResolvedValue(fakeOrder({ status: DeliveryStatus.SEARCHING })),
            createQueryBuilder: jest.fn(() => sharedQueryBuilder),
          },
        });

      const { service: serviceA } = buildRacer();
      const { service: serviceB } = buildRacer();

      const results = await Promise.allSettled([
        serviceA.cancelDelivery('order-1', 'customer-1', 'customer' as any, {}),
        serviceB.cancelDelivery('order-1', 'customer-1', 'customer' as any, {}),
      ]);

      expect(claims).toBe(1);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    });
  });
});

describe('LogisticsService.markDelivered — payment settlement safety', () => {
  function baseDriverProfile(overrides: Record<string, any> = {}) {
    return {
      id: 'profile-1',
      userId: 'driver-1',
      activeVehicleId: null,
      commissionOverridePercent: '10',
      fleetCompanyId: null,
      level: 'standard',
      ...overrides,
    };
  }

  function buildForMarkDelivered(overrides: Record<string, any> = {}) {
    const order = fakeOrder({
      id: 'order-1',
      driverId: 'driver-1', // must match the driverUserId passed to markDelivered() below, or getOwnedByDriver() rejects it
      status: DeliveryStatus.IN_TRANSIT,
      totalFare: '1000.00',
      paymentMethod: overrides.paymentMethod ?? PaymentMethod.WALLET,
      ...overrides.orderOverrides,
    });

    const savedOrders: DeliveryOrder[] = [];
    const ordersRepo = {
      findOne: jest.fn().mockResolvedValue(order),
      save: jest.fn(async (data: DeliveryOrder) => {
        savedOrders.push({ ...data });
        Object.assign(order, data);
        return data;
      }),
    };

    const { service, deps } = buildService({
      ordersRepo,
      driversService: {
        findByUserId: jest.fn().mockResolvedValue(baseDriverProfile(overrides.driverProfile)),
        recordTripOutcome: jest.fn(),
        restoreAvailabilityAfterTrip: jest.fn(),
      },
      walletsService: {
        getByUserId: jest.fn().mockResolvedValue({ id: 'wallet-1' }),
        debit: jest.fn().mockResolvedValue(undefined),
        credit: jest.fn().mockResolvedValue(undefined),
        ...overrides.walletsService,
      },
      paymentsService: {
        chargeSavedCard: jest.fn(),
        ...overrides.paymentsService,
      },
      corporateService: {
        getAccountForEmployee: jest.fn(),
        debitForRide: jest.fn(),
        ...overrides.corporateService,
      },
      usersService: {
        findById: jest.fn().mockResolvedValue({ id: 'customer-1', email: 'customer@example.com' }),
        ...overrides.usersService,
      },
      promotionsService: {
        grantReferralBonusIfEligible: jest.fn(),
      },
      events: { emit: jest.fn() },
    });

    return { service, deps, order, savedOrders };
  }

  it('debits the customer wallet and credits driver earnings on a normal wallet-paid delivery', async () => {
    const { service, deps, order } = buildForMarkDelivered({ paymentMethod: PaymentMethod.WALLET });

    const result = await service.markDelivered('order-1', 'driver-1');

    expect(result.status).toBe(DeliveryStatus.DELIVERED);
    expect(deps.walletsService.debit).toHaveBeenCalledWith(
      'wallet-1',
      1000,
      expect.anything(),
      'order-1',
      expect.any(String),
    );
    expect(deps.walletsService.credit).toHaveBeenCalled();
    expect(order.earningsSettled).toBe(true);
  });

  /**
   * Regression test for the fix: if the customer has already been
   * charged (wallet debit succeeded) but crediting the driver's
   * earnings then fails, the order must stay DELIVERED — not revert to
   * a retryable state, which would let a client retry markDelivered()
   * and charge the customer's wallet a second time for the same
   * delivery.
   */
  it('does NOT revert the order or rethrow when the customer has already been charged but crediting the driver fails', async () => {
    const { service, deps, order } = buildForMarkDelivered({
      paymentMethod: PaymentMethod.WALLET,
      walletsService: {
        getByUserId: jest.fn().mockResolvedValue({ id: 'wallet-1' }),
        debit: jest.fn().mockResolvedValue(undefined),
        credit: jest.fn().mockRejectedValue(new Error('driver wallet not found')),
      },
    });

    const result = await service.markDelivered('order-1', 'driver-1');

    expect(result.status).toBe(DeliveryStatus.DELIVERED);
    expect(deps.walletsService.debit).toHaveBeenCalledTimes(1); // charged exactly once
    expect(order.earningsSettled).toBeFalsy(); // left unsettled for ops follow-up
    expect(deps.events.emit).toHaveBeenCalledWith(
      'driver_earnings.credit_failed',
      expect.objectContaining({ orderId: 'order-1', driverId: 'driver-1' }),
    );
  });

  /**
   * Contrasting case: when the customer was never actually charged
   * (the debit itself fails, e.g. insufficient balance), the order
   * must revert to its pre-delivery status so the driver can safely
   * retry — this is the existing, correct behaviour being preserved,
   * not the new fix.
   */
  it('reverts the order to its previous status when the customer charge itself fails', async () => {
    const { service, deps, order } = buildForMarkDelivered({
      paymentMethod: PaymentMethod.WALLET,
      walletsService: {
        getByUserId: jest.fn().mockResolvedValue({ id: 'wallet-1' }),
        debit: jest.fn().mockRejectedValue(new Error('Insufficient wallet balance')),
        credit: jest.fn(),
      },
    });

    await expect(service.markDelivered('order-1', 'driver-1')).rejects.toThrow(
      'Insufficient wallet balance',
    );

    expect(order.status).toBe(DeliveryStatus.IN_TRANSIT); // reverted, not left DELIVERED
    expect(order.deliveredAt).toBeNull();
    expect(deps.walletsService.credit).not.toHaveBeenCalled();
  });

  it('does not double-charge on a card payment once the driver-credit step fails', async () => {
    const { service, deps, order } = buildForMarkDelivered({
      paymentMethod: PaymentMethod.CARD,
      paymentsService: {
        chargeSavedCard: jest.fn().mockResolvedValue({ status: 'success' }),
      },
      walletsService: {
        getByUserId: jest.fn().mockResolvedValue({ id: 'wallet-1' }),
        credit: jest.fn().mockRejectedValue(new Error('driver wallet not found')),
        debit: jest.fn(),
      },
    });

    const result = await service.markDelivered('order-1', 'driver-1');

    expect(result.status).toBe(DeliveryStatus.DELIVERED);
    expect(deps.paymentsService.chargeSavedCard).toHaveBeenCalledTimes(1); // charged exactly once
    expect(deps.events.emit).toHaveBeenCalledWith(
      'driver_earnings.credit_failed',
      expect.objectContaining({ orderId: 'order-1' }),
    );
  });
});

describe('LogisticsService.getForUser — ownership check on the detail endpoint (batch 11)', () => {
  it('lets the customer who placed the order see it', async () => {
    const { service, deps } = buildService({
      ordersRepo: { findOne: jest.fn().mockResolvedValue(fakeOrder({ customerId: 'customer-1' })) },
    });

    const result = await service.getForUser('order-1', 'customer-1', UserRole.PASSENGER);

    expect(result.id).toBe('order-1');
  });

  it('lets the assigned driver see it', async () => {
    const { service } = buildService({
      ordersRepo: {
        findOne: jest.fn().mockResolvedValue(fakeOrder({ customerId: 'customer-1', driverId: 'driver-1' })),
      },
    });

    const result = await service.getForUser('order-1', 'driver-1', UserRole.DRIVER);

    expect(result.id).toBe('order-1');
  });

  it('lets staff (e.g. support) see it', async () => {
    const { service } = buildService({
      ordersRepo: { findOne: jest.fn().mockResolvedValue(fakeOrder({ customerId: 'customer-1' })) },
    });

    const result = await service.getForUser('order-1', 'agent-1', UserRole.SUPPORT_AGENT);

    expect(result.id).toBe('order-1');
  });

  it(
    "rejects an unrelated authenticated user (IDOR fix — findById() alone is not an authorization " +
      'check, and the controller must not call it directly for this endpoint)',
    async () => {
      const { service } = buildService({
        ordersRepo: { findOne: jest.fn().mockResolvedValue(fakeOrder({ customerId: 'customer-1' })) },
      });

      await expect(
        service.getForUser('order-1', 'some-other-passenger', UserRole.PASSENGER),
      ).rejects.toThrow(ForbiddenException);
    },
  );

  it('rejects a driver who was never assigned this order — the whole point of MANUAL courier selection is that unselected drivers never learn the order exists', async () => {
    const { service } = buildService({
      ordersRepo: {
        findOne: jest.fn().mockResolvedValue(
          fakeOrder({ customerId: 'customer-1', driverId: null, status: DeliveryStatus.SEARCHING }),
        ),
      },
    });

    await expect(
      service.getForUser('order-1', 'uninvolved-driver', UserRole.DRIVER),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects a driver who was assigned a *different* order', async () => {
    const { service } = buildService({
      ordersRepo: {
        findOne: jest.fn().mockResolvedValue(
          fakeOrder({ id: 'order-1', customerId: 'customer-1', driverId: 'driver-on-other-order' }),
        ),
      },
    });

    await expect(
      service.getForUser('order-1', 'driver-1', UserRole.DRIVER),
    ).rejects.toThrow(ForbiddenException);
  });
});
