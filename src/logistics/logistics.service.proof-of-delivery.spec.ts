import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { LogisticsService } from './logistics.service';
import { DeliveryStatus } from './entities/delivery-order.entity';
import { PaymentMethod } from '../common/enums/ride.enum';

function fakeOrder(overrides: Record<string, any> = {}) {
  return {
    id: 'order-1',
    driverId: 'driver-1',
    customerId: 'customer-1',
    status: DeliveryStatus.IN_TRANSIT,
    requiresSignature: false,
    paymentMethod: PaymentMethod.CASH,
    totalFare: '2000.00',
    city: 'Lagos',
    ...overrides,
  };
}

function build(overrides: Record<string, any> = {}) {
  const ordersRepo = {
    findOne: jest.fn().mockResolvedValue(fakeOrder()),
    save: jest.fn(async (o: any) => o),
    ...overrides.ordersRepo,
  };
  const driversService = {
    findByUserId: jest.fn().mockResolvedValue({ userId: 'driver-1', level: 'standard', activeVehicleId: null, fleetCompanyId: null }),
    recordTripOutcome: jest.fn().mockResolvedValue(undefined),
    restoreAvailabilityAfterTrip: jest.fn().mockResolvedValue(undefined),
    ...overrides.driversService,
  };
  const commissionService = { resolveCommissionPercent: jest.fn().mockResolvedValue(20) };
  const walletsService = {
    getByUserId: jest.fn().mockResolvedValue({ id: 'wallet-driver-1' }),
    debit: jest.fn().mockResolvedValue(undefined),
    ...overrides.walletsService,
  };
  const events = { emit: jest.fn() };
  const metrics = {};

  const deps = {
    ordersRepo,
    config: { get: jest.fn() },
    driversService,
    vehiclesService: {},
    walletsService,
    commissionService,
    corporateService: {},
    fleetService: {},
    usersService: {},
    paymentsService: {},
    reconciliationService: { recordDebt: jest.fn().mockResolvedValue(undefined) },
    settingsService: { getNumber: jest.fn() },
    vehicleTypesService: {},
    candidateSearchService: {},
    driverRankingService: {},
    events,
    metrics,
    geofenceService: {},
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
    deps.geofenceService as any,
  );

  return { service, ordersRepo, driversService, reconciliationService: deps.reconciliationService };
}

const validProof = { photoUrl: 'https://cdn.example.com/delivery-proof/photo.jpg' };

describe('LogisticsService.markDelivered() - proof-of-delivery validation', () => {
  it('refuses to complete delivery without a photo', async () => {
    const { service } = build();

    await expect(service.markDelivered('order-1', 'driver-1', {} as any)).rejects.toThrow(BadRequestException);
  });

  it('completes delivery with just a photo when the order does not require a signature', async () => {
    const { service, ordersRepo } = build();

    await service.markDelivered('order-1', 'driver-1', validProof);

    expect(ordersRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: DeliveryStatus.DELIVERED, proofPhotoUrl: validProof.photoUrl }),
    );
  });

  it('refuses to complete a signature-required delivery with only a photo', async () => {
    const { service, ordersRepo } = build({
      ordersRepo: { findOne: jest.fn().mockResolvedValue(fakeOrder({ requiresSignature: true })) },
    });

    await expect(service.markDelivered('order-1', 'driver-1', validProof)).rejects.toThrow(BadRequestException);
    expect(ordersRepo.save).not.toHaveBeenCalled();
  });

  it('completes a signature-required delivery once both photo and signature are provided', async () => {
    const { service, ordersRepo } = build({
      ordersRepo: { findOne: jest.fn().mockResolvedValue(fakeOrder({ requiresSignature: true })) },
    });

    await service.markDelivered('order-1', 'driver-1', {
      ...validProof,
      signatureUrl: 'https://cdn.example.com/delivery-proof/sig.png',
    });

    expect(ordersRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ proofSignatureUrl: 'https://cdn.example.com/delivery-proof/sig.png' }),
    );
  });

  it('stores the recipient name and delivery GPS when provided', async () => {
    const { service, ordersRepo } = build();

    await service.markDelivered('order-1', 'driver-1', {
      ...validProof,
      recipientName: 'Chidinma (neighbour)',
      deliveryLat: 6.5244,
      deliveryLng: 3.3792,
    });

    expect(ordersRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ proofRecipientName: 'Chidinma (neighbour)', proofDeliveryLat: 6.5244, proofDeliveryLng: 3.3792 }),
    );
  });

  it('stores null (not undefined) for optional proof fields that were not provided', async () => {
    const { service, ordersRepo } = build();

    await service.markDelivered('order-1', 'driver-1', validProof);

    expect(ordersRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ proofSignatureUrl: null, proofRecipientName: null, proofDeliveryLat: null, proofDeliveryLng: null }),
    );
  });

  it('still refuses to complete a delivery that is not actually in transit or picked up, before even checking proof', async () => {
    const { service } = build({
      ordersRepo: { findOne: jest.fn().mockResolvedValue(fakeOrder({ status: DeliveryStatus.REQUESTED })) },
    });

    await expect(service.markDelivered('order-1', 'driver-1', validProof)).rejects.toThrow(BadRequestException);
  });

  it("still refuses when the calling driver doesn't actually own this delivery", async () => {
    const { service } = build({
      ordersRepo: { findOne: jest.fn().mockResolvedValue(fakeOrder({ driverId: 'someone-else' })) },
    });

    await expect(service.markDelivered('order-1', 'driver-1', validProof)).rejects.toThrow(ForbiddenException);
  });
});

describe('LogisticsService.markDelivered() - COD collection tracking', () => {
  const codOrder = () => fakeOrder({ isCod: true, codAmount: '5000.00' });

  it('refuses to complete a COD delivery with no collected amount reported at all', async () => {
    const { service } = build({ ordersRepo: { findOne: jest.fn().mockResolvedValue(codOrder()) } });

    await expect(service.markDelivered('order-1', 'driver-1', validProof)).rejects.toThrow(BadRequestException);
  });

  it('marks COLLECTED when the driver reports at least the expected amount', async () => {
    const { service, ordersRepo, reconciliationService } = build({
      ordersRepo: { findOne: jest.fn().mockResolvedValue(codOrder()) },
    });

    await service.markDelivered('order-1', 'driver-1', { ...validProof, codCollectedAmount: 5000 });

    expect(ordersRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ codCollectionStatus: 'collected', codCollectedAmount: '5000.00' }),
    );
    expect(reconciliationService.recordDebt).not.toHaveBeenCalled();
  });

  it('marks PARTIAL and records a driver debt for exactly the shortfall when less than expected was collected', async () => {
    const { service, ordersRepo, reconciliationService } = build({
      ordersRepo: { findOne: jest.fn().mockResolvedValue(codOrder()) },
    });

    await service.markDelivered('order-1', 'driver-1', { ...validProof, codCollectedAmount: 3000 });

    expect(ordersRepo.save).toHaveBeenCalledWith(expect.objectContaining({ codCollectionStatus: 'partial' }));
    expect(reconciliationService.recordDebt).toHaveBeenCalledWith('driver-1', null, 'order-1', 2000, 'delivery');
  });

  it('marks FAILED (not PARTIAL) when nothing at all was collected', async () => {
    const { service, ordersRepo, reconciliationService } = build({
      ordersRepo: { findOne: jest.fn().mockResolvedValue(codOrder()) },
    });

    await service.markDelivered('order-1', 'driver-1', { ...validProof, codCollectedAmount: 0 });

    expect(ordersRepo.save).toHaveBeenCalledWith(expect.objectContaining({ codCollectionStatus: 'failed' }));
    expect(reconciliationService.recordDebt).toHaveBeenCalledWith('driver-1', null, 'order-1', 5000, 'delivery');
  });

  it('attributes the debt to the fleet company, not the individual driver, when the driver belongs to one', async () => {
    const { service, reconciliationService } = build({
      ordersRepo: { findOne: jest.fn().mockResolvedValue(codOrder()) },
      driversService: {
        findByUserId: jest.fn().mockResolvedValue({ userId: 'driver-1', level: 'standard', activeVehicleId: null, fleetCompanyId: 'fleet-9' }),
      },
    });

    await service.markDelivered('order-1', 'driver-1', { ...validProof, codCollectedAmount: 3000 });

    expect(reconciliationService.recordDebt).toHaveBeenCalledWith('driver-1', 'fleet-9', 'order-1', 2000, 'delivery');
  });

  it('never touches COD fields or records any debt at all for a non-COD order', async () => {
    const { service, ordersRepo, reconciliationService } = build();

    await service.markDelivered('order-1', 'driver-1', validProof);

    const saved = ordersRepo.save.mock.calls[0][0];
    expect(saved.codCollectionStatus).toBeUndefined();
    expect(reconciliationService.recordDebt).not.toHaveBeenCalled();
  });
});

describe('LogisticsService.listOutstandingCodReconciliations() / reconcileCodShortfall()', () => {
  it('only returns COD orders that are PARTIAL/FAILED and not yet reconciled', async () => {
    const qb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(2),
      getMany: jest.fn().mockResolvedValue([{ id: 'order-1' }, { id: 'order-2' }]),
    };
    const { service } = build({ ordersRepo: { createQueryBuilder: jest.fn().mockReturnValue(qb) } });

    const result = await service.listOutstandingCodReconciliations();

    expect(qb.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('codCollectionStatus IN'),
      expect.objectContaining({ statuses: ['partial', 'failed'] }),
    );
    expect(qb.andWhere).toHaveBeenCalledWith(expect.stringContaining('codReconciledAt IS NULL'));
    expect(result.items).toHaveLength(2);
  });

  it('marks a shortfall reconciled by setting codReconciledAt', async () => {
    const { service, ordersRepo } = build({
      ordersRepo: { findOne: jest.fn().mockResolvedValue({ id: 'order-1', isCod: true, codCollectionStatus: 'partial' }) },
    });

    await service.reconcileCodShortfall('order-1');

    expect(ordersRepo.save).toHaveBeenCalledWith(expect.objectContaining({ codReconciledAt: expect.any(Date) }));
  });

  it('refuses to reconcile an order with no outstanding shortfall (COLLECTED, or not COD at all)', async () => {
    const { service } = build({
      ordersRepo: { findOne: jest.fn().mockResolvedValue({ id: 'order-1', isCod: true, codCollectionStatus: 'collected' }) },
    });

    await expect(service.reconcileCodShortfall('order-1')).rejects.toThrow(BadRequestException);
  });
});

describe('LogisticsService.listForAdmin()', () => {
  function buildQb(overrides: Record<string, any> = {}) {
    return {
      leftJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(0),
      getRawMany: jest.fn().mockResolvedValue([]),
      ...overrides,
    };
  }

  it('filters to only active (not yet terminal) deliveries when activeOnly is set', async () => {
    const qb = buildQb();
    const { service } = build({ ordersRepo: { createQueryBuilder: jest.fn().mockReturnValue(qb) } });

    await service.listForAdmin({ activeOnly: true });

    expect(qb.andWhere).toHaveBeenCalledWith(
      'order.status IN (:...activeStatuses)',
      expect.objectContaining({
        activeStatuses: expect.arrayContaining([DeliveryStatus.IN_TRANSIT, DeliveryStatus.PICKED_UP]),
      }),
    );
    const activeStatusesArg = qb.andWhere.mock.calls.find((c: any[]) => c[0].includes('activeStatuses'))[1].activeStatuses;
    expect(activeStatusesArg).not.toContain(DeliveryStatus.DELIVERED);
    expect(activeStatusesArg).not.toContain(DeliveryStatus.FAILED);
    expect(activeStatusesArg).not.toContain(DeliveryStatus.CANCELLED);
  });

  it('filters by an exact status when given (e.g. failed deliveries specifically)', async () => {
    const qb = buildQb();
    const { service } = build({ ordersRepo: { createQueryBuilder: jest.fn().mockReturnValue(qb) } });

    await service.listForAdmin({ status: DeliveryStatus.FAILED });

    expect(qb.andWhere).toHaveBeenCalledWith('order.status = :status', { status: DeliveryStatus.FAILED });
  });
});

describe('LogisticsService.getRevenueSummary()', () => {
  it('only counts DELIVERED orders and computes a correct average fare', async () => {
    const qb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ orderCount: '4', totalRevenue: '8000', totalCommission: '1600', totalDriverEarnings: '6400' }),
    };
    const { service } = build({ ordersRepo: { createQueryBuilder: jest.fn().mockReturnValue(qb) } });

    const result = await service.getRevenueSummary();

    expect(qb.where).toHaveBeenCalledWith('order.status = :status', { status: DeliveryStatus.DELIVERED });
    expect(result).toEqual({
      orderCount: 4,
      totalRevenue: '8000.00',
      totalCommission: '1600.00',
      totalDriverEarnings: '6400.00',
      averageFare: '2000.00',
    });
  });

  it('reports a zero average fare (not NaN or a crash) when there are no delivered orders at all', async () => {
    const qb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ orderCount: '0', totalRevenue: '0', totalCommission: '0', totalDriverEarnings: '0' }),
    };
    const { service } = build({ ordersRepo: { createQueryBuilder: jest.fn().mockReturnValue(qb) } });

    const result = await service.getRevenueSummary();

    expect(result.averageFare).toBe('0.00');
  });
});

describe('LogisticsService.getCourierPerformance()', () => {
  it('computes accurate delivered/failed/cancelled counts and average rating', async () => {
    const orders = [
      { status: DeliveryStatus.DELIVERED, driverRating: 5, driverEarnings: '400.00', isCod: false },
      { status: DeliveryStatus.DELIVERED, driverRating: 3, driverEarnings: '600.00', isCod: false },
      { status: DeliveryStatus.FAILED, driverRating: null, driverEarnings: null, isCod: false },
      { status: DeliveryStatus.CANCELLED, driverRating: null, driverEarnings: null, isCod: false },
    ];
    const { service } = build({ ordersRepo: { find: jest.fn().mockResolvedValue(orders) } });

    const result = await service.getCourierPerformance('driver-1');

    expect(result.totalOrders).toBe(4);
    expect(result.deliveredCount).toBe(2);
    expect(result.failedCount).toBe(1);
    expect(result.cancelledCount).toBe(1);
    expect(result.averageRating).toBe('4.00');
    expect(result.totalEarnings).toBe('1000.00');
  });

  it('reports null COD reliability (not 0%) for a courier with no COD deliveries at all', async () => {
    const { service } = build({
      ordersRepo: { find: jest.fn().mockResolvedValue([{ status: DeliveryStatus.DELIVERED, isCod: false, driverEarnings: '100.00' }]) },
    });

    const result = await service.getCourierPerformance('driver-1');

    expect(result.codReliabilityPercent).toBeNull();
  });

  it('computes COD reliability as the share of COD deliveries fully collected, not partial/failed', async () => {
    const orders = [
      { status: DeliveryStatus.DELIVERED, isCod: true, codCollectionStatus: 'collected', driverEarnings: '100' },
      { status: DeliveryStatus.DELIVERED, isCod: true, codCollectionStatus: 'collected', driverEarnings: '100' },
      { status: DeliveryStatus.DELIVERED, isCod: true, codCollectionStatus: 'partial', driverEarnings: '100' },
      { status: DeliveryStatus.DELIVERED, isCod: true, codCollectionStatus: 'failed', driverEarnings: '100' },
    ];
    const { service } = build({ ordersRepo: { find: jest.fn().mockResolvedValue(orders) } });

    const result = await service.getCourierPerformance('driver-1');

    expect(result.codReliabilityPercent).toBe(50);
  });

  it('reports null average rating (not 0) for a courier with no rated deliveries yet', async () => {
    const { service } = build({
      ordersRepo: { find: jest.fn().mockResolvedValue([{ status: DeliveryStatus.DELIVERED, driverRating: null, driverEarnings: '100', isCod: false }]) },
    });

    const result = await service.getCourierPerformance('driver-1');

    expect(result.averageRating).toBeNull();
  });
});
