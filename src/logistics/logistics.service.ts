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
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  DeliveryOrder,
  DeliveryCancelledBy,
  DeliveryStatus,
  DeliveryVehicleType,
  DeliveryDispatchMode,
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
import { UserRole } from '../common/enums/user-role.enum';
import { haversineDistanceKm } from '../common/utils/geo.util';
import { DriversService } from '../drivers/drivers.service';
import { VehiclesService } from '../vehicles/vehicles.service';
import { WalletsService } from '../wallets/wallets.service';
import { CommissionService } from '../commission/commission.service';
import { CorporateService } from '../corporate/corporate.service';
import { FleetService } from '../fleet/fleet.service';
import { UsersService } from '../users/users.service';
import { PaymentsService } from '../payments/payments.service';
import { PaymentStatus } from '../payments/entities/payment-record.entity';
import { ReconciliationService } from '../reconciliation/reconciliation.service';
import {
  SystemSettingsService,
  SETTING_KEYS,
} from '../settings/settings.service';
import { DeliveryVehicleTypesService } from './delivery-vehicle-types.service';
import { canVehicleCoverDelivery } from '../common/vehicle-capacity-match.util';
import { CandidateSearchService } from '../candidate-search/candidate-search.service';
import {
  DispatchDomain,
  DispatchMode,
} from '../candidate-search/candidate-search.types';
import { DriverRankingService } from '../ranking/ranking.service';
import { MetricsService } from '../observability/metrics.service';
import { PromotionsService } from '../promotions/promotions.service';

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

// Same roster rides.service.ts's STAFF_ROLES uses — staff who can see
// any ride can see any delivery, for the same support/ops reasons.
const STAFF_ROLES = [
  UserRole.ADMIN,
  UserRole.SUPER_ADMIN,
  UserRole.SUPPORT_AGENT,
  UserRole.DISPATCHER,
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
    private readonly promotionsService: PromotionsService,
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

  async findById(id: string): Promise<DeliveryOrder> {
    const order = await this.ordersRepo.findOne({ where: { id } });
    if (!order) throw new NotFoundException('Delivery order not found');
    return order;
  }

  /**
   * Authorization-checked lookup for the customer-/driver-facing detail
   * endpoint (GET /deliveries/:id) — findById() above is the plain,
   * unchecked repository read used internally by every other method here
   * once it's already established the caller is entitled to this order
   * (via customerId/driverId match, an explicit select-courier ownership
   * check, etc). The controller was calling findById() directly, with no
   * ownership check of any kind — any authenticated user, passenger or
   * driver, could fetch any delivery's full detail (pickup/dropoff
   * addresses, both contacts' names and phone numbers, item description
   * and value, COD amount) by id alone, which is a real IDOR: mirrors
   * exactly the gap rides.service.ts's getForUser() exists to close for
   * the equivalent ride endpoint.
   *
   * Deliberately narrower than rides' getForUser(): rides also admits a
   * driver with a live *offer* on the ride, because a targeted offer is
   * the one case where a driver legitimately needs to see ride detail
   * before deciding whether to accept. Deliveries have no equivalent
   * offer/reservation record for a not-yet-assigned driver (see
   * acceptDelivery()'s doc comment — broadcast, first-accept-wins, by
   * design) — extending the same exception here for "any eligible
   * candidate" would mean re-running the live candidate search just to
   * authorize a read, and would defeat the entire point of MANUAL orders
   * not broadcasting to begin with (a driver could learn full detail of
   * a delivery they were never offered). So until this order has an
   * assigned driver, only the customer who placed it (or staff) can see it.
   */
  async getForUser(
    orderId: string,
    requesterId: string,
    requesterRole: UserRole,
  ): Promise<DeliveryOrder> {
    const order = await this.findById(orderId);
    const isParticipant =
      order.customerId === requesterId || order.driverId === requesterId;
    const isStaff = STAFF_ROLES.includes(requesterRole);
    if (!isParticipant && !isStaff) {
      throw new ForbiddenException("You don't have access to this delivery");
    }
    return order;
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
    return this.ordersRepo.save(order);
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
    return this.ordersRepo.save(order);
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
    return this.ordersRepo.save(order);
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

    const previousStatus = order.status;
    order.status = DeliveryStatus.DELIVERED;
    order.deliveredAt = new Date();
    order.commissionPercent = commissionPercent.toFixed(2);
    order.commissionAmount = commissionAmount.toFixed(2);
    order.driverEarnings = driverEarnings.toFixed(2);
    await this.ordersRepo.save(order);

    try {
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
        await this.settleDriverEarningsAfterPayerCharged(
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
        await this.settleDriverEarningsAfterPayerCharged(
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
        await this.corporateService.debitForRide(account.id, totalFare, order.id);
        await this.settleDriverEarningsAfterPayerCharged(
          order,
          driverProfile,
          driverEarnings,
          commissionPercent,
        );
      }
    } catch (err) {
      // Same failure mode rides.service.ts's completeRide() was fixed for:
      // without this, a payment failure here (e.g. insufficient wallet
      // balance, declined card, no email on file) left the order
      // permanently stuck marked DELIVERED with no payment ever taken.
      // Reverting puts the order back in a genuinely consistent,
      // retryable state rather than needing a manual database fix.
      order.status = previousStatus;
      order.deliveredAt = null;
      order.commissionPercent = null;
      order.commissionAmount = null;
      order.driverEarnings = null;
      await this.ordersRepo.save(order);
      throw err;
    }

    await this.driversService.recordTripOutcome(driverProfile.id, 'completed');
    await this.driversService.restoreAvailabilityAfterTrip(driverUserId);
    // Same gap as rides.service.ts's completeRide() had before it was
    // fixed: grantReferralBonusIfEligible() is generic per user account,
    // not ride-specific, but nothing on the delivery side ever called
    // it for either party. Covering both here for parity with rides -
    // a courier-only customer or driver account should get the same
    // "your first completed trip" referral honor a rider/driver does.
    await this.promotionsService.grantReferralBonusIfEligible(order.customerId);
    await this.promotionsService.grantReferralBonusIfEligible(driverUserId);

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

    return order;
  }

  private async settleDriverEarningsAfterPayerCharged(
    order: DeliveryOrder,
    driverProfile: { userId: string; fleetCompanyId: string | null },
    driverEarnings: number,
    commissionPercent: number,
  ): Promise<void> {
    try {
      await this.creditDriverEarnings(
        order,
        driverProfile,
        driverEarnings,
        commissionPercent,
      );
    } catch (err) {
      this.events.emit('driver_earnings.credit_failed', {
        orderId: order.id,
        driverId: driverProfile.userId,
        amount: driverEarnings,
        reason: err instanceof Error ? err.message : 'Unknown error crediting driver earnings',
      });
    }
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
