import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { UserRole, SAFETY_OPS_ROLES } from '../common/enums/user-role.enum';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  DeliveryOrder,
  DeliveryCancelledBy,
  DeliveryStatus,
  DeliveryVehicleType,
  DeliveryDispatchMode,
  CodCollectionStatus,
} from './entities/delivery-order.entity';
import {
  EstimateDeliveryDto,
  RequestDeliveryDto,
  CancelDeliveryDto,
} from './dto/logistics.dto';
import { RateDeliveryDto } from './dto/rate-delivery.dto';
import { PaymentMethod } from '../common/enums/ride.enum';
import { TransactionCategory } from '../common/enums/transaction.enum';
import {
  DriverApprovalStatus,
} from '../common/enums/driver-status.enum';
import { DriverService, isOnlineForService } from '../common/enums/driver-service.enum';
import { haversineDistanceKm } from '../common/utils/geo.util';
import { DriversService } from '../drivers/drivers.service';
import { VehiclesService } from '../vehicles/vehicles.service';
import { WalletsService } from '../wallets/wallets.service';
import { User } from '../users/entities/user.entity';
import { CommissionService } from '../commission/commission.service';
import { CorporateService } from '../corporate/corporate.service';
import { FleetService } from '../fleet/fleet.service';
import { UsersService } from '../users/users.service';
import { PaymentsService } from '../payments/payments.service';
import { PaymentStatus } from '../payments/entities/payment-record.entity';
import { ReconciliationService } from '../reconciliation/reconciliation.service';
import { ReconciliationSourceType } from '../reconciliation/entities/cash-reconciliation.entity';
import {
  SystemSettingsService,
  SETTING_KEYS,
} from '../settings/settings.service';
import { DeliveryVehicleTypesService } from './delivery-vehicle-types.service';
import { canVehicleCoverDelivery } from '../common/vehicle-capacity-match.util';
import { VehicleStatus } from '../common/enums/vehicle.enum';
import { CandidateSearchService } from '../candidate-search/candidate-search.service';
import {
  DispatchDomain,
  DispatchMode,
} from '../candidate-search/candidate-search.types';
import { DriverRankingService } from '../ranking/ranking.service';
import { GeofenceService } from '../tracking/geofence/geofence.service';
import { MetricsService } from '../observability/metrics.service';

export interface DeliveryFareBreakdown {
  baseFare: number;
  distanceFare: number;
  weightFare: number;
  totalFare: number;
  estimatedDistanceKm: number;
  currency: string;
}

/**
 * Passenger-safe courier candidate shape for OPTION B's candidate list
 * — deliberately excludes internal driver database ids, phone numbers,
 * documents, and Redis internals. `id` is the driver's userId, already
 * treated as public-ish elsewhere (Ride/DeliveryOrder.driverId).
 */
export interface CourierCandidateResult {
  id: string;
  firstName: string;
  profilePhoto: string | null;
  rating: number;
  vehicle: {
    category: string;
    make: string | null;
    model: string | null;
    color: string | null;
  };
  etaMinutes: number;
  distanceKm: number;
}

// Every status before DELIVERED/CANCELLED/FAILED - what "active
// deliveries" means for the admin list's activeOnly filter.
const ACTIVE_DELIVERY_STATUSES = [
  DeliveryStatus.REQUESTED,
  DeliveryStatus.SEARCHING,
  DeliveryStatus.ACCEPTED,
  DeliveryStatus.PICKUP_ARRIVED,
  DeliveryStatus.PICKED_UP,
  DeliveryStatus.IN_TRANSIT,
];

@Injectable()
export class LogisticsService {
  private readonly logger = new Logger(LogisticsService.name);

  constructor(
    @InjectRepository(DeliveryOrder)
    private readonly ordersRepo: Repository<DeliveryOrder>,
    private readonly config: ConfigService,
    private readonly driversService: DriversService,
    private readonly vehiclesService: VehiclesService,
    private readonly walletsService: WalletsService,
    private readonly commissionService: CommissionService,
    private readonly corporateService: CorporateService,
    private readonly fleetService: FleetService,
    private readonly usersService: UsersService,
    private readonly paymentsService: PaymentsService,
    private readonly reconciliationService: ReconciliationService,
    private readonly settingsService: SystemSettingsService,
    private readonly vehicleTypesService: DeliveryVehicleTypesService,
    private readonly candidateSearchService: CandidateSearchService,
    private readonly driverRankingService: DriverRankingService,
    private readonly events: EventEmitter2,
    private readonly metrics: MetricsService,
    private readonly geofenceService: GeofenceService,
  ) {}

  async estimateFare(dto: EstimateDeliveryDto): Promise<DeliveryFareBreakdown> {
    const distanceKm = haversineDistanceKm(
      dto.pickupLat,
      dto.pickupLng,
      dto.dropoffLat,
      dto.dropoffLng,
    );

    let baseFare: number;
    let perKm: number;
    let perKg: number;
    let minimumFare: number;

    // A vehicle type's own configured pricing takes precedence -
    // that's the whole point of #8 (bike/keke/car/van/pickup/truck each
    // pricing differently). Falling back to the flat settings when no
    // type is given keeps any existing caller that predates this
    // feature working exactly as before, rather than breaking it.
    if (dto.vehicleType) {
      const vehicleConfig = await this.vehicleTypesService.getByType(
        dto.vehicleType,
      );
      const maxWeightKg = parseFloat(vehicleConfig.maxWeightKg);
      if (dto.weightKg && dto.weightKg > maxWeightKg) {
        throw new BadRequestException(
          `${dto.weightKg}kg exceeds the ${maxWeightKg}kg limit for this vehicle type. Choose a larger vehicle.`,
        );
      }
      baseFare = parseFloat(vehicleConfig.baseFare);
      perKm = parseFloat(vehicleConfig.perKm);
      perKg = parseFloat(vehicleConfig.perKg);
      minimumFare = parseFloat(vehicleConfig.minimumFare);
    } else {
      baseFare = await this.settingsService.getNumber(
        SETTING_KEYS.LOGISTICS_BASE_FARE,
        this.config.get<number>('logistics.baseFare')!,
      );
      perKm = await this.settingsService.getNumber(
        SETTING_KEYS.LOGISTICS_PER_KM,
        this.config.get<number>('logistics.perKm')!,
      );
      perKg = await this.settingsService.getNumber(
        SETTING_KEYS.LOGISTICS_PER_KG,
        this.config.get<number>('logistics.perKg')!,
      );
      minimumFare = await this.settingsService.getNumber(
        SETTING_KEYS.LOGISTICS_MINIMUM_FARE,
        this.config.get<number>('logistics.minimumFare')!,
      );
    }

    const currency = this.config.get<string>('pricing.currency')!;
    const distanceFare = distanceKm * perKm;
    const weightFare = (dto.weightKg ?? 0) * perKg;
    const totalFare = Math.max(
      baseFare + distanceFare + weightFare,
      minimumFare,
    );

    return {
      baseFare: this.round(baseFare),
      distanceFare: this.round(distanceFare),
      weightFare: this.round(weightFare),
      totalFare: this.round(totalFare),
      estimatedDistanceKm: this.round(distanceKm),
      currency,
    };
  }

  async requestDelivery(
    customerId: string,
    dto: RequestDeliveryDto,
  ): Promise<DeliveryOrder> {
    // Same enforcement as RidesService.requestRide() - a delivery
    // pickup/dropoff outside the configured service area shouldn't be
    // accepted just because a route could technically be calculated.
    const [pickupServed, dropoffServed] = await Promise.all([
      this.geofenceService.isWithinServiceArea(dto.pickupLat, dto.pickupLng),
      this.geofenceService.isWithinServiceArea(dto.dropoffLat, dto.dropoffLng),
    ]);
    if (!pickupServed) {
      throw new BadRequestException('This pickup location is outside our current service area');
    }
    if (!dropoffServed) {
      throw new BadRequestException('This dropoff location is outside our current service area');
    }

    const breakdown = await this.estimateFare(dto);
    const paymentMethod = dto.paymentMethod ?? PaymentMethod.CASH;
    const dispatchMode = dto.dispatchMode ?? DeliveryDispatchMode.AUTO;

    if (paymentMethod === PaymentMethod.CORPORATE) {
      const account =
        await this.corporateService.getAccountForEmployee(customerId);
      if (!account) {
        throw new BadRequestException(
          'You are not linked to an active corporate account',
        );
      }
    }
    if (dto.isCod && paymentMethod !== PaymentMethod.CASH) {
      throw new BadRequestException(
        'Cash on delivery requires paymentMethod=cash',
      );
    }

    const order = this.ordersRepo.create({
      customerId,
      category: dto.category,
      vehicleType: dto.vehicleType ?? DeliveryVehicleType.CAR,
      dispatchMode,
      status: DeliveryStatus.SEARCHING,
      pickupLat: dto.pickupLat,
      pickupLng: dto.pickupLng,
      pickupAddress: dto.pickupAddress,
      pickupContactName: dto.pickupContactName,
      pickupContactPhone: dto.pickupContactPhone,
      dropoffLat: dto.dropoffLat,
      dropoffLng: dto.dropoffLng,
      dropoffAddress: dto.dropoffAddress,
      dropoffContactName: dto.dropoffContactName,
      dropoffContactPhone: dto.dropoffContactPhone,
      itemDescription: dto.itemDescription,
      itemValue: dto.itemValue?.toFixed(2) ?? null,
      weightKg: dto.weightKg?.toFixed(2) ?? null,
      requiresSignature: !!dto.requiresSignature,
      isCod: !!dto.isCod,
      codAmount: dto.codAmount?.toFixed(2) ?? null,
      city: dto.city ?? null,
      estimatedDistanceKm: breakdown.estimatedDistanceKm,
      baseFare: breakdown.baseFare.toFixed(2),
      distanceFare: breakdown.distanceFare.toFixed(2),
      weightFare: breakdown.weightFare.toFixed(2),
      totalFare: breakdown.totalFare.toFixed(2),
      paymentMethod,
    });

    const saved = await this.ordersRepo.save(order);
    this.emitDeliveryStatusChanged(saved);

    // MANUAL ("choose a courier") deliberately does NOT broadcast here —
    // notifying every eligible driver the moment the order exists would
    // let any of them accept before the passenger ever sees a candidate
    // list, defeating the entire point of choosing. The passenger instead
    // calls findSelectableCouriers()/selectCourier() below, and only the
    // driver they pick is ever told a delivery exists.
    if (dispatchMode === DeliveryDispatchMode.MANUAL) {
      this.logger.log(
        `COURIER request: deliveryId=${saved.id} dispatchMode=manual pickup=(${dto.pickupLat.toFixed(4)},${dto.pickupLng.toFixed(4)}) ` +
          `— awaiting passenger to select a courier, no broadcast sent`,
      );
      return saved;
    }

    // Real gap found while checking notification coverage against the
    // full requested trigger list — deliveries use an open,
    // any-driver-can-accept model (no targeted offer like rides have),
    // which meant nobody was ever told a new delivery even existed. A
    // driver would only discover one by manually checking the list.
    //
    // Uses the exact same shared pipeline rides use —
    // CandidateSearchService (Redis-backed live driver index ->
    // eligibility -> progressive radius) and DriverRankingService (road-
    // ETA ranking) — rather than the legacy findNearby() Postgres scan
    // this used to call directly. That scan is also what used to do the
    // vehicle-capability filtering by hand here; CandidateSearchService's
    // COURIER-domain eligibility already does the identical
    // canVehicleCoverDelivery() check internally, so there's no separate
    // filtering step left to duplicate.
    //
    // AUTO here mirrors AUTO rides — nothing waits for a human to choose
    // a specific driver before notifying. MANUAL orders take the early
    // return above instead.
    const searchOutcome = await this.candidateSearchService.search({
      pickup: { lat: dto.pickupLat, lng: dto.pickupLng },
      domain: DispatchDomain.COURIER,
      mode: DispatchMode.AUTO,
      deliveryVehicleType: saved.vehicleType,
      minCandidates: 1,
      limit: 10,
    });

    if (searchOutcome.candidates.length > 0) {
      // Ranked by ETA (best first) purely so whichever notification
      // channel consumes this list (push batching, in-app ordering)
      // can surface the most useful drivers first — the actual
      // acceptance is still first-to-call-acceptDelivery()-wins, this
      // doesn't reserve or target anyone the way a ride offer does.
      const rankingOutcome = await this.driverRankingService.rank(
        { lat: dto.pickupLat, lng: dto.pickupLng },
        searchOutcome.candidates,
      );

      this.events.emit('delivery.requested', {
        driverUserIds: rankingOutcome.ranked.map((c) => c.driverUserId),
        deliveryId: saved.id,
        pickupAddress: dto.pickupAddress,
      });

      // Structured dispatch log (batch 9) — same shape AUTO ride
      // dispatch already logs, for the courier notify step.
      this.logger.log(
        `COURIER notify: deliveryId=${saved.id} dispatchMode=auto pickup=(${dto.pickupLat.toFixed(4)},${dto.pickupLng.toFixed(4)}) ` +
          `finalRadiusKm=${searchOutcome.radiusUsedKm} candidateCount=${rankingOutcome.ranked.length} selectedDriver=broadcast_first_accept_wins selectionReason=eta_ranked_notify_order`,
      );
    } else {
      // courier_no_driver_rate's numerator (batch 9) — divide against
      // total delivery requests. Mirrors autoDispatchNoDriverFoundTotal's
      // role for rides; courier has no NO_DRIVER_FOUND status of its own
      // to key off (the order just sits in SEARCHING for the customer to
      // cancel or retry), so this is tracked here at the request step
      // rather than via a status transition.
      this.metrics.courierDispatchNoDriverFoundTotal.inc();
      this.logger.warn(
        `COURIER notify: deliveryId=${saved.id} dispatchMode=auto pickup=(${dto.pickupLat.toFixed(4)},${dto.pickupLng.toFixed(4)}) ` +
          `finalRadiusKm=${searchOutcome.radiusUsedKm} candidateCount=0 — no eligible driver found, order left in ${saved.status}`,
      );
    }

    return saved;
  }

  /**
   * The passenger-facing candidate list for OPTION B ("choose a
   * courier"), mirroring rides.service.ts's findSelectableDrivers() —
   * same shared CandidateSearchService + DriverRankingService pipeline,
   * never a second search implementation. Returns only passenger-safe
   * fields; `id` here is the driver's userId, which is already the
   * identifier the rest of this app treats as public-ish (it's what
   * Ride/DeliveryOrder.driverId holds once assigned) rather than an
   * internal database row id.
   */
  async findSelectableCouriers(
    orderId: string,
    customerId: string,
  ): Promise<CourierCandidateResult[]> {
    const order = await this.findById(orderId);
    if (order.customerId !== customerId)
      throw new ForbiddenException('This is not your delivery');
    if (
      order.status !== DeliveryStatus.SEARCHING &&
      order.status !== DeliveryStatus.REQUESTED
    ) {
      return [];
    }

    const searchOutcome = await this.candidateSearchService.search({
      pickup: { lat: order.pickupLat, lng: order.pickupLng },
      domain: DispatchDomain.COURIER,
      mode: DispatchMode.MANUAL,
      deliveryVehicleType: order.vehicleType,
      // A passenger picking manually wants a real list, not just the
      // first courier found — same reasoning as rides' MANUAL list.
      minCandidates: 3,
      limit: 10,
    });

    if (searchOutcome.candidates.length === 0) return [];

    const rankingOutcome = await this.driverRankingService.rank(
      { lat: order.pickupLat, lng: order.pickupLng },
      searchOutcome.candidates,
    );

    const userIds = rankingOutcome.ranked.map((c) => c.driverUserId);
    const vehicleIds = rankingOutcome.ranked.map((c) => c.vehicleId);
    const [users, vehicles] = await Promise.all([
      this.usersService.findByIds(userIds),
      Promise.all(
        vehicleIds.map((id) =>
          this.vehiclesService.findById(id).catch(() => null),
        ),
      ),
    ]);
    const userById = new Map(users.map((u) => [u.id, u]));
    const vehicleById = new Map(
      vehicles
        .filter((v): v is NonNullable<typeof v> => !!v)
        .map((v) => [v.id, v]),
    );

    return rankingOutcome.ranked.map((c) => {
      const user = userById.get(c.driverUserId);
      const vehicle = vehicleById.get(c.vehicleId);
      return {
        id: c.driverUserId,
        firstName: user?.firstName ?? 'Courier',
        profilePhoto: user?.profilePhotoUrl ?? null,
        rating: c.rating,
        vehicle: {
          category: vehicle?.category ?? c.vehicleCategory,
          make: vehicle?.make ?? null,
          model: vehicle?.model ?? null,
          color: vehicle?.color ?? null,
        },
        etaMinutes: c.etaMinutes,
        distanceKm: c.distanceKm,
      };
    });
  }

  /**
   * The passenger's explicit pick for OPTION B. Deliberately does NOT
   * introduce a separate targeted-offer-with-driver-decline step the
   * way rides' selectDriver()/offerToSpecificDriver() do — courier
   * already treats "accept" as the moment of assignment (broadcast,
   * first-to-call-acceptDelivery()-wins, see requestDelivery() above),
   * and building full offer/timeout infra for courier too is real,
   * separate scope. Instead this re-validates the driver is still
   * eligible right now (same membership check rides' selectDriver()
   * does) and then reserves them through the exact same atomic
   * transaction acceptDelivery() uses — so a driver who went offline,
   * on-trip, or lost vehicle compatibility between the passenger
   * loading the list and tapping a name is rejected here, and two
   * passengers (or a passenger and a broadcast accept) racing for the
   * same driver still only ever produce one winner.
   */
  async selectCourier(
    orderId: string,
    customerId: string,
    driverUserId: string,
  ): Promise<DeliveryOrder> {
    const order = await this.findById(orderId);
    if (order.customerId !== customerId)
      throw new ForbiddenException('This is not your delivery');
    if (
      order.status !== DeliveryStatus.SEARCHING &&
      order.status !== DeliveryStatus.REQUESTED
    ) {
      throw new BadRequestException(
        `Cannot select a courier while the delivery is ${order.status}`,
      );
    }

    const searchOutcome = await this.candidateSearchService.search({
      pickup: { lat: order.pickupLat, lng: order.pickupLng },
      domain: DispatchDomain.COURIER,
      mode: DispatchMode.MANUAL,
      deliveryVehicleType: order.vehicleType,
      // Only need to confirm this one driver is still eligible, not
      // build a fresh list — see rides.service.ts's selectDriver() for
      // why minCandidates is set high rather than searching for one.
      minCandidates: 20,
      limit: 50,
    });

    const stillEligible = searchOutcome.candidates.some(
      (c) => c.driverUserId === driverUserId,
    );
    if (!stillEligible) {
      throw new BadRequestException(
        'That courier is no longer available — please refresh and pick another.',
      );
    }

    return this.acceptDelivery(orderId, driverUserId);
  }

  /** Delivery equivalent of RidesService.emitStatusChanged() - see that method's doc comment for why this is a separate, new event rather than reusing the existing delivery.* ones. */
  private emitDeliveryStatusChanged(order: DeliveryOrder): void {
    this.events.emit('delivery.status_changed', {
      deliveryId: order.id,
      status: order.status,
      customerId: order.customerId,
      driverId: order.driverId,
    });
  }

  async findById(id: string): Promise<DeliveryOrder> {
    const order = await this.ordersRepo.findOne({ where: { id } });
    if (!order) throw new NotFoundException('Delivery order not found');
    return order;
  }

  /**
   * Real gap this closes: the controller's GET /:id previously called
   * findById() directly with only a "logged in" check (JwtAuthGuard) -
   * any authenticated user, on any account, could view any OTHER
   * customer's full delivery details (name, phone, both addresses,
   * item description/value, COD amount) just by knowing the order's
   * id. findById() itself deliberately stays unrestricted, since it's
   * also used internally by methods that apply their own different
   * ownership check for a different actor (e.g. findSelectableCouriers
   * checks customerId specifically) - this wraps it with the same
   * participant-or-staff check the equivalent single-ride lookup in
   * RidesService already uses.
   */
  async findByIdForParticipant(id: string, requesterId: string, requesterRole: UserRole): Promise<DeliveryOrder> {
    const order = await this.findById(id);
    const isParticipant = order.customerId === requesterId || order.driverId === requesterId;
    const isStaff = SAFETY_OPS_ROLES.includes(requesterRole);
    if (!isParticipant && !isStaff) {
      throw new ForbiddenException("You don't have access to this delivery");
    }
    return order;
  }

  /**
   * COD orders where the driver reported collecting less than
   * expected (or nothing at all) and nobody has reconciled it yet -
   * the admin worklist this feature exists to drive. A COLLECTED
   * order never appears here at all (nothing to reconcile); a
   * PARTIAL/FAILED one drops off the list the moment codReconciledAt
   * is set, not before.
   */
  async listOutstandingCodReconciliations(page = 1, limit = 25) {
    const qb = this.ordersRepo
      .createQueryBuilder('order')
      .where('order.isCod = true')
      .andWhere('order.codCollectionStatus IN (:...statuses)', {
        statuses: [CodCollectionStatus.PARTIAL, CodCollectionStatus.FAILED],
      })
      .andWhere('order.codReconciledAt IS NULL')
      .orderBy('order.deliveredAt', 'ASC'); // oldest shortfall first

    const total = await qb.getCount();
    const items = await qb
      .offset((page - 1) * limit)
      .limit(limit)
      .getMany();

    return { items, total, page, limit };
  }

  /** Marks a COD shortfall as reconciled - the debt itself (recorded at delivery time, see markDelivered()) is settled separately via ReconciliationService, same as any other driver debt. */
  async reconcileCodShortfall(orderId: string): Promise<DeliveryOrder> {
    const order = await this.findById(orderId);
    if (!order.isCod || order.codCollectionStatus === CodCollectionStatus.COLLECTED) {
      throw new BadRequestException('This order has no outstanding COD shortfall to reconcile');
    }
    order.codReconciledAt = new Date();
    return this.ordersRepo.save(order);
  }

  /**
   * Admin delivery list/search - same gap RidesService.listForAdmin()
   * closed for rides, now closed here: before this, nothing let staff
   * look up deliveries at all beyond a customer's or driver's own
   * `/mine` view. Same query-builder join pattern (User joined twice
   * by role, no new service dependencies just for names) as that
   * method, deliberately kept identical rather than inventing a
   * different shape for a very similar list.
   */
  async listForAdmin(
    filter?: { status?: DeliveryStatus; activeOnly?: boolean; search?: string },
    page = 1,
    limit = 25,
  ) {
    const qb = this.ordersRepo
      .createQueryBuilder('order')
      .leftJoin(User, 'customer', 'customer.id::text = order.customerId')
      .leftJoin(User, 'driver', 'driver.id::text = order.driverId')
      .select('order.id', 'id')
      .addSelect('order.status', 'status')
      .addSelect('order.category', 'category')
      .addSelect('order.vehicleType', 'vehicleType')
      .addSelect('order.pickupAddress', 'pickupAddress')
      .addSelect('order.dropoffAddress', 'dropoffAddress')
      .addSelect('order.city', 'city')
      .addSelect('order.totalFare', 'totalFare')
      .addSelect('order.paymentMethod', 'paymentMethod')
      .addSelect('order.isCod', 'isCod')
      .addSelect('order.codCollectionStatus', 'codCollectionStatus')
      .addSelect('order.createdAt', 'createdAt')
      .addSelect('order.deliveredAt', 'deliveredAt')
      .addSelect('customer.firstName', 'customerFirstName')
      .addSelect('customer.lastName', 'customerLastName')
      .addSelect('customer.phone', 'customerPhone')
      .addSelect('driver.firstName', 'driverFirstName')
      .addSelect('driver.lastName', 'driverLastName')
      .addSelect('driver.phone', 'driverPhone')
      .orderBy('order.createdAt', 'DESC');

    if (filter?.status) {
      qb.andWhere('order.status = :status', { status: filter.status });
    }
    if (filter?.activeOnly) {
      qb.andWhere('order.status IN (:...activeStatuses)', { activeStatuses: ACTIVE_DELIVERY_STATUSES });
    }
    if (filter?.search) {
      qb.andWhere(
        `(CAST(order.id AS TEXT) ILIKE :search
          OR customer."firstName" ILIKE :search OR customer."lastName" ILIKE :search OR customer.phone ILIKE :search
          OR driver."firstName" ILIKE :search OR driver."lastName" ILIKE :search OR driver.phone ILIKE :search)`,
        { search: `%${filter.search}%` },
      );
    }

    const total = await qb.getCount();
    const items = await qb
      .offset((page - 1) * limit)
      .limit(limit)
      .getRawMany();

    return { items, total, page, limit };
  }

  /**
   * Revenue over a date range (defaults to all time) - only counts
   * DELIVERED orders, since a cancelled/failed order never actually
   * earned anything regardless of what its estimated fare said.
   */
  async getRevenueSummary(from?: Date, to?: Date) {
    const qb = this.ordersRepo
      .createQueryBuilder('order')
      .where('order.status = :status', { status: DeliveryStatus.DELIVERED });
    if (from) qb.andWhere('order.deliveredAt >= :from', { from });
    if (to) qb.andWhere('order.deliveredAt <= :to', { to });

    const row = await qb
      .select('COUNT(*)', 'orderCount')
      .addSelect('COALESCE(SUM(order.totalFare), 0)', 'totalRevenue')
      .addSelect('COALESCE(SUM(order.commissionAmount), 0)', 'totalCommission')
      .addSelect('COALESCE(SUM(order.driverEarnings), 0)', 'totalDriverEarnings')
      .getRawOne();

    const orderCount = parseInt(row.orderCount, 10);
    return {
      orderCount,
      totalRevenue: parseFloat(row.totalRevenue).toFixed(2),
      totalCommission: parseFloat(row.totalCommission).toFixed(2),
      totalDriverEarnings: parseFloat(row.totalDriverEarnings).toFixed(2),
      averageFare: orderCount > 0 ? (parseFloat(row.totalRevenue) / orderCount).toFixed(2) : '0.00',
    };
  }

  /**
   * Per-courier delivery stats - completion/failure/cancellation
   * counts, average rating, total earnings, and COD reliability (the
   * share of their COD deliveries that came back fully collected,
   * not partial or failed). A driver with zero COD deliveries gets
   * null here rather than a misleading 100% or 0%.
   */
  async getCourierPerformance(driverUserId: string) {
    const orders = await this.ordersRepo.find({ where: { driverId: driverUserId } });

    const delivered = orders.filter((o) => o.status === DeliveryStatus.DELIVERED);
    const failed = orders.filter((o) => o.status === DeliveryStatus.FAILED);
    const cancelled = orders.filter((o) => o.status === DeliveryStatus.CANCELLED);
    const rated = delivered.filter((o) => o.driverRating != null);
    const codDelivered = delivered.filter((o) => o.isCod);
    const codFullyCollected = codDelivered.filter((o) => o.codCollectionStatus === CodCollectionStatus.COLLECTED);

    return {
      driverUserId,
      totalOrders: orders.length,
      deliveredCount: delivered.length,
      failedCount: failed.length,
      cancelledCount: cancelled.length,
      averageRating: rated.length > 0 ? (rated.reduce((sum, o) => sum + (o.driverRating ?? 0), 0) / rated.length).toFixed(2) : null,
      totalEarnings: delivered.reduce((sum, o) => sum + parseFloat(o.driverEarnings ?? '0'), 0).toFixed(2),
      codReliabilityPercent: codDelivered.length > 0 ? Math.round((codFullyCollected.length / codDelivered.length) * 100) : null,
    };
  }

  async findForCustomer(customerId: string): Promise<DeliveryOrder[]> {
    return this.ordersRepo.find({
      where: { customerId },
      order: { createdAt: 'DESC' },
    });
  }

  async findForDriver(driverId: string): Promise<DeliveryOrder[]> {
    return this.ordersRepo.find({
      where: { driverId },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Customer rates the driver after a completed delivery. Same
   * customer-only, completed-only, rate-once rules as
   * RidesService.rateDriver(), and feeds the same
   * driversService.applyRating() - a driver has one overall rating
   * across both rides and deliveries, not two separate scores, since
   * both reflect the same person's actual service quality.
   */
  async rateDriver(
    orderId: string,
    customerId: string,
    dto: RateDeliveryDto,
  ): Promise<DeliveryOrder> {
    const order = await this.findById(orderId);
    if (order.customerId !== customerId)
      throw new ForbiddenException('Not your delivery');
    if (order.status !== DeliveryStatus.DELIVERED) {
      throw new BadRequestException('Can only rate a completed delivery');
    }
    if (order.driverRating != null) {
      throw new BadRequestException('This delivery has already been rated');
    }
    if (!order.driverId)
      throw new BadRequestException('This delivery has no driver to rate');

    order.driverRating = dto.rating;
    order.driverRatingComment = dto.comment ?? null;
    await this.ordersRepo.save(order);

    const driverProfile = await this.driversService.findByUserId(
      order.driverId,
    );
    await this.driversService.applyRating(driverProfile.id, dto.rating);

    return order;
  }

  /**
   * First driver to call this wins — deliveries stay a broadcast/first-
   * accept-wins model, unlike rides' targeted single-offer flow, so
   * there's no equivalent to RidesService's offer-exclusivity check
   * here. What there IS an equivalent of is the driver-level reservation
   * race rides had before it was fixed: two concurrent accept calls for
   * the same driver — two deliveries, or a delivery and a ride — must
   * not both succeed.
   *
   * reserveOnlineDriverForTrip() is the same atomic, conditional
   * ONLINE->ON_TRIP UPDATE rides.service.ts's acceptRide() uses, run
   * inside the same transaction as this delivery's own atomic claim.
   * Because it's the exact same method operating on the exact same
   * driver_profiles.availability column, a driver mid-accept on a ride
   * cannot simultaneously be accepted onto a delivery, and vice versa —
   * there's only one lock, shared by both domains, not two separate ones
   * that could each think they'd won.
   */
  async acceptDelivery(
    orderId: string,
    driverUserId: string,
  ): Promise<DeliveryOrder> {
    const order = await this.findById(orderId);
    if (
      order.status !== DeliveryStatus.SEARCHING &&
      order.status !== DeliveryStatus.REQUESTED
    ) {
      throw new BadRequestException(
        `Delivery cannot be accepted from status ${order.status}`,
      );
    }

    // Read-only pre-checks for a clear, specific error message before
    // opening a transaction — the real, race-proof enforcement of
    // "driver must actually still be ONLINE" is reserveOnlineDriverForTrip()'s
    // conditional UPDATE below, not this snapshot read.
    const driverProfile = await this.driversService.findByUserId(driverUserId);
    if (driverProfile.approvalStatus !== DriverApprovalStatus.APPROVED) {
      throw new ForbiddenException('Driver is not approved');
    }
    if (!isOnlineForService(driverProfile.availability, DriverService.DELIVERY)) {
      throw new BadRequestException(
        'Driver must be online for deliveries to accept deliveries',
      );
    }
    if (!driverProfile.activeVehicleId) {
      throw new BadRequestException(
        'You need an active vehicle on file to accept deliveries',
      );
    }
    const vehicle = await this.vehiclesService.findById(
      driverProfile.activeVehicleId,
    );
    if (vehicle.status !== VehicleStatus.ACTIVE) {
      throw new BadRequestException(
        `Your registered vehicle is ${vehicle.status.replace(/_/g, ' ')}, not active - it needs to be approved before you can accept deliveries.`,
      );
    }
    if (!canVehicleCoverDelivery(vehicle.category, order.vehicleType)) {
      throw new BadRequestException(
        `Your registered vehicle can't cover a ${order.vehicleType} delivery. A larger vehicle is required.`,
      );
    }

    const { saved, reservedProfile } =
      await this.ordersRepo.manager.transaction(async (manager) => {
        const reservedProfile =
          await this.driversService.reserveOnlineDriverForTrip(
            manager,
            driverUserId,
            DriverService.DELIVERY,
          );

        const updateResult = await manager
          .createQueryBuilder()
          .update(DeliveryOrder)
          .set({
            driverId: driverUserId,
            vehicleId: reservedProfile.activeVehicleId,
            status: DeliveryStatus.ACCEPTED,
            acceptedAt: new Date(),
          })
          .where('id = :id', { id: orderId })
          .andWhere('status IN (:...statuses)', {
            statuses: [DeliveryStatus.SEARCHING, DeliveryStatus.REQUESTED],
          })
          .execute();

        if (updateResult.affected !== 1) {
          // Rolls back reserveOnlineDriverForTrip()'s UPDATE too — the
          // driver goes right back to ONLINE, exactly as if this call had
          // never happened.
          throw new BadRequestException(
            'This delivery was just accepted by another driver.',
          );
        }

        const savedOrder = await manager.findOneOrFail(DeliveryOrder, {
          where: { id: orderId },
        });
        return { saved: savedOrder, reservedProfile };
      });

    // Only after the transaction actually commits — see
    // reserveOnlineDriverForTrip()'s doc comment in drivers.service.ts
    // for why this can't happen any earlier.
    this.driversService.emitReservedForTrip(reservedProfile);
    this.emitDeliveryStatusChanged(saved);

    return saved;
  }

  async markPickupArrived(
    orderId: string,
    driverUserId: string,
  ): Promise<DeliveryOrder> {
    const order = await this.getOwnedByDriver(orderId, driverUserId);
    if (order.status !== DeliveryStatus.ACCEPTED) {
      throw new BadRequestException(
        'Delivery must be accepted before marking pickup arrival',
      );
    }
    order.status = DeliveryStatus.PICKUP_ARRIVED;
    const saved = await this.ordersRepo.save(order);
    this.emitDeliveryStatusChanged(saved);
    return saved;
  }

  async markPickedUp(
    orderId: string,
    driverUserId: string,
  ): Promise<DeliveryOrder> {
    const order = await this.getOwnedByDriver(orderId, driverUserId);
    if (
      order.status !== DeliveryStatus.PICKUP_ARRIVED &&
      order.status !== DeliveryStatus.ACCEPTED
    ) {
      throw new BadRequestException(
        'Delivery must be accepted/at pickup before marking picked up',
      );
    }
    order.status = DeliveryStatus.PICKED_UP;
    order.pickedUpAt = new Date();
    const saved = await this.ordersRepo.save(order);
    this.emitDeliveryStatusChanged(saved);
    return saved;
  }

  async markInTransit(
    orderId: string,
    driverUserId: string,
  ): Promise<DeliveryOrder> {
    const order = await this.getOwnedByDriver(orderId, driverUserId);
    if (order.status !== DeliveryStatus.PICKED_UP) {
      throw new BadRequestException(
        'Delivery must be picked up before marking in transit',
      );
    }
    order.status = DeliveryStatus.IN_TRANSIT;
    const saved = await this.ordersRepo.save(order);
    this.emitDeliveryStatusChanged(saved);
    return saved;
  }

  /**
   * Marks the order delivered and settles payment — same shape as
   * RidesService.completeRide: wallet/cash/card/corporate all supported,
   * COD is a variant of cash (customer pays driver directly, driver owes
   * platform commission out of their own wallet/fleet wallet).
   */
  async markDelivered(
    orderId: string,
    driverUserId: string,
    proof: {
      photoUrl: string;
      signatureUrl?: string;
      recipientName?: string;
      deliveryLat?: number;
      deliveryLng?: number;
      codCollectedAmount?: number;
    },
  ): Promise<DeliveryOrder> {
    const order = await this.getOwnedByDriver(orderId, driverUserId);
    if (
      order.status !== DeliveryStatus.IN_TRANSIT &&
      order.status !== DeliveryStatus.PICKED_UP
    ) {
      throw new BadRequestException(
        'Delivery must be picked up/in transit to complete',
      );
    }
    // A photo is always required - cheap for the driver to capture and
    // the single piece of evidence that protects both sides in almost
    // every "was this actually delivered" dispute. Signature is only
    // required when THIS order was flagged for it at creation time
    // (order.requiresSignature) - most deliveries never ask for one.
    if (!proof.photoUrl) {
      throw new BadRequestException('A delivery photo is required to complete this delivery');
    }
    if (order.requiresSignature && !proof.signatureUrl) {
      throw new BadRequestException('This delivery requires a recipient signature to complete');
    }
    // A COD delivery must report what was actually collected - the
    // driver can't just mark it delivered and leave the money
    // unaccounted for, since that's exactly the gap this feature
    // exists to close.
    if (order.isCod && proof.codCollectedAmount == null) {
      throw new BadRequestException('Report the amount collected to complete a cash-on-delivery order');
    }

    const driverProfile = await this.driversService.findByUserId(driverUserId);
    const vehicleCategory = driverProfile.activeVehicleId
      ? (await this.vehiclesService.findById(driverProfile.activeVehicleId))
          .category
      : undefined;

    const commissionPercent =
      driverProfile.commissionOverridePercent != null
        ? parseFloat(driverProfile.commissionOverridePercent)
        : await this.commissionService.resolveCommissionPercent({
            driverLevel: driverProfile.level,
            vehicleCategory,
            city: order.city ?? undefined,
          });

    const totalFare = parseFloat(order.totalFare);
    const commissionAmount = this.round(totalFare * (commissionPercent / 100));
    const driverEarnings = this.round(totalFare - commissionAmount);

    order.status = DeliveryStatus.DELIVERED;
    order.deliveredAt = new Date();
    order.proofPhotoUrl = proof.photoUrl;
    order.proofSignatureUrl = proof.signatureUrl ?? null;
    order.proofRecipientName = proof.recipientName ?? null;
    order.proofDeliveryLat = proof.deliveryLat ?? null;
    order.proofDeliveryLng = proof.deliveryLng ?? null;

    if (order.isCod) {
      const expected = parseFloat(order.codAmount ?? '0');
      const collected = proof.codCollectedAmount!;
      order.codCollectedAmount = collected.toFixed(2);
      order.codCollectionStatus =
        collected >= expected
          ? CodCollectionStatus.COLLECTED
          : collected > 0
            ? CodCollectionStatus.PARTIAL
            : CodCollectionStatus.FAILED;

      // Courier responsibility: a shortfall is the driver's own debt,
      // not absorbed silently or left for the customer to be chased
      // for again - same recordDebt() mechanism already used for a
      // commission shortfall a few lines below, just against the
      // gap between what was expected and what actually came back.
      const shortfall = this.round(expected - collected);
      if (shortfall > 0) {
        await this.reconciliationService.recordDebt(driverUserId, driverProfile.fleetCompanyId, order.id, shortfall, ReconciliationSourceType.DELIVERY);
      }
    }
    order.commissionPercent = commissionPercent.toFixed(2);
    order.commissionAmount = commissionAmount.toFixed(2);
    order.driverEarnings = driverEarnings.toFixed(2);
    await this.ordersRepo.save(order);
    this.emitDeliveryStatusChanged(order);

    if (order.paymentMethod === PaymentMethod.WALLET) {
      const customerWallet = await this.walletsService.getByUserId(
        order.customerId,
      );
      await this.walletsService.debit(
        customerWallet.id,
        totalFare,
        TransactionCategory.DELIVERY_PAYMENT,
        order.id,
        `Delivery payment for order ${order.id}`,
      );
      await this.creditDriverEarnings(
        order,
        driverProfile,
        driverEarnings,
        commissionPercent,
      );
    } else if (order.paymentMethod === PaymentMethod.CASH) {
      // COD or plain cash — either way the driver collected cash directly,
      // so only the commission owed is debited from them (or their fleet).
      // Falls back to a tracked reconciliation debt (auto-settles on the
      // next wallet credit) rather than blocking delivery completion if
      // the balance can't cover it right now — same pattern as rides.
      if (driverProfile.fleetCompanyId) {
        try {
          await this.fleetService.debitFleetCommission(
            driverProfile.fleetCompanyId,
            commissionAmount,
            order.id,
          );
        } catch {
          await this.reconciliationService.recordDebt(
            null,
            driverProfile.fleetCompanyId,
            order.id,
            commissionAmount,
            ReconciliationSourceType.DELIVERY,
          );
        }
      } else {
        const driverWallet =
          await this.walletsService.getByUserId(driverUserId);
        try {
          await this.walletsService.debit(
            driverWallet.id,
            commissionAmount,
            TransactionCategory.COMMISSION,
            order.id,
            `Commission owed on delivery ${order.id} (${commissionPercent}%)`,
          );
        } catch {
          await this.reconciliationService.recordDebt(
            driverUserId,
            null,
            order.id,
            commissionAmount,
            ReconciliationSourceType.DELIVERY,
          );
        }
      }
      order.earningsSettled = true;
      await this.ordersRepo.save(order);
    } else if (order.paymentMethod === PaymentMethod.CARD) {
      const customer = await this.usersService.findById(order.customerId);
      if (!customer.email) {
        throw new BadRequestException(
          'Add an email to your account before paying by card',
        );
      }
      const payment = await this.paymentsService.chargeSavedCard(
        order.id,
        order.customerId,
        customer.email,
        totalFare,
      );
      if (payment.status !== PaymentStatus.SUCCESS) {
        throw new BadRequestException(
          payment.failureReason ?? 'Card payment failed',
        );
      }
      await this.creditDriverEarnings(
        order,
        driverProfile,
        driverEarnings,
        commissionPercent,
      );
    } else if (order.paymentMethod === PaymentMethod.CORPORATE) {
      const account = await this.corporateService.getAccountForEmployee(
        order.customerId,
      );
      if (!account)
        throw new BadRequestException(
          'Customer is not linked to a corporate account',
        );
      await this.corporateService.debitForRide(account.id, totalFare, order.id, order.customerId);
      await this.creditDriverEarnings(
        order,
        driverProfile,
        driverEarnings,
        commissionPercent,
      );
    }

    await this.driversService.recordTripOutcome(driverProfile.id, 'completed');
    await this.driversService.restoreAvailabilityAfterTrip(driverUserId);

    this.events.emit('delivery.delivered', {
      customerId: order.customerId,
      driverId: driverUserId,
      totalFare: order.totalFare,
    });

    return order;
  }

  async cancelDelivery(
    orderId: string,
    actorUserId: string,
    cancelledBy: DeliveryCancelledBy,
    dto: CancelDeliveryDto,
  ): Promise<DeliveryOrder> {
    const order = await this.findById(orderId);

    if (
      cancelledBy === DeliveryCancelledBy.CUSTOMER &&
      order.customerId !== actorUserId
    ) {
      throw new ForbiddenException('Not your delivery');
    }
    if (
      cancelledBy === DeliveryCancelledBy.DRIVER &&
      order.driverId !== actorUserId
    ) {
      throw new ForbiddenException('Not your delivery');
    }
    if (
      order.status === DeliveryStatus.DELIVERED ||
      order.status === DeliveryStatus.CANCELLED
    ) {
      throw new BadRequestException(
        `Delivery cannot be cancelled from status ${order.status}`,
      );
    }

    // Same lost-update risk cancelRide() had, and the same fix: claim the
    // cancellation atomically, conditioned on the delivery still being in
    // the exact status just read. A plain save() here raced against a
    // concurrent acceptDelivery() (SEARCHING/REQUESTED -> ACCEPTED) could
    // otherwise commit after acceptDelivery's transaction and silently
    // overwrite the order back to CANCELLED — leaving a driver reserved
    // ON_TRIP for a delivery that no longer exists from the customer's
    // point of view.
    const originalStatus = order.status;
    const claimResult = await this.ordersRepo
      .createQueryBuilder()
      .update(DeliveryOrder)
      .set({
        status: DeliveryStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelledBy,
        cancelReason: dto.reason ?? null,
      })
      .where('id = :id', { id: order.id })
      .andWhere('status = :originalStatus', { originalStatus })
      .execute();

    if (claimResult.affected !== 1) {
      throw new BadRequestException(
        'This delivery just changed status (it may already have been accepted, delivered, or cancelled) — please refresh and try again.',
      );
    }

    order.status = DeliveryStatus.CANCELLED;
    order.cancelledAt = new Date();
    order.cancelledBy = cancelledBy;
    order.cancelReason = dto.reason ?? null;

    if (order.driverId) {
      const driverProfile = await this.driversService.findByUserId(
        order.driverId,
      );
      await this.driversService.recordTripOutcome(
        driverProfile.id,
        'cancelled',
      );
      await this.driversService.restoreAvailabilityAfterTrip(order.driverId);
    }

    const notifyUserId =
      cancelledBy === DeliveryCancelledBy.CUSTOMER
        ? order.driverId
        : order.customerId;
    if (notifyUserId) {
      this.events.emit('delivery.cancelled', {
        notifyUserId,
        reason: order.cancelReason,
      });
    }
    this.emitDeliveryStatusChanged(order);

    return order;
  }

  private async creditDriverEarnings(
    order: DeliveryOrder,
    driverProfile: { userId: string; fleetCompanyId: string | null },
    driverEarnings: number,
    commissionPercent: number,
  ): Promise<void> {
    if (driverProfile.fleetCompanyId) {
      await this.fleetService.creditForRideEarning(
        driverProfile.fleetCompanyId,
        driverEarnings,
        order.id,
      );
    } else {
      const driverWallet = await this.walletsService.getByUserId(
        driverProfile.userId,
      );
      await this.walletsService.credit(
        driverWallet.id,
        driverEarnings,
        TransactionCategory.DELIVERY_EARNING,
        order.id,
        `Earnings for delivery ${order.id} (commission ${commissionPercent}%)`,
      );
    }
    order.earningsSettled = true;
    await this.ordersRepo.save(order);
  }

  private async getOwnedByDriver(
    orderId: string,
    driverUserId: string,
  ): Promise<DeliveryOrder> {
    const order = await this.findById(orderId);
    if (order.driverId !== driverUserId) {
      throw new ForbiddenException('Not your delivery');
    }
    return order;
  }

  private round(value: number): number {
    return Math.round(value * 100) / 100;
  }
}
