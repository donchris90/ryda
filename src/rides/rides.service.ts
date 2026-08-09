import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Ride } from './entities/ride.entity';
import { GoogleMapsService } from '../maps/google-maps.service';
import { decodePolyline } from '../common/utils/polyline.util';
import { FareService } from './fare.service';
import { FareEstimateDto } from './dto/fare-estimate.dto';
import { RequestRideDto } from './dto/request-ride.dto';
import { CancelRideDto } from './dto/cancel-ride.dto';
import { RateRideDto } from './dto/rate-ride.dto';
import { RideStatus, PaymentMethod, CancelledBy } from '../common/enums/ride.enum';
import { DriversService, NearbyDriverResult } from '../drivers/drivers.service';
import { DriverProfile } from '../drivers/entities/driver-profile.entity';
import { VehiclesService } from '../vehicles/vehicles.service';
import { WalletsService } from '../wallets/wallets.service';
import { CommissionService } from '../commission/commission.service';
import { UsersService } from '../users/users.service';
import { User } from '../users/entities/user.entity';
import { PaymentsService } from '../payments/payments.service';
import { PaymentStatus } from '../payments/entities/payment-record.entity';
import { CorporateService } from '../corporate/corporate.service';
import { PassengersService } from '../passengers/passengers.service';
import { PromotionsService } from '../promotions/promotions.service';
import { FleetService } from '../fleet/fleet.service';
import { DispatchService } from '../dispatch/dispatch.service';
import { PricingService } from '../ai/pricing.service';
import { ReconciliationService } from '../reconciliation/reconciliation.service';
import { SystemSettingsService, SETTING_KEYS } from '../settings/settings.service';
import { MetricsService } from '../observability/metrics.service';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '../common/enums/user-role.enum';
import { randomUUID } from 'crypto';

const STAFF_ROLES = [
  UserRole.ADMIN,
  UserRole.SUPER_ADMIN,
  UserRole.SUPPORT_AGENT,
  UserRole.DISPATCHER,
];
import { EventEmitter2 } from '@nestjs/event-emitter';
import { TransactionCategory } from '../common/enums/transaction.enum';
import { DriverAvailability, DriverApprovalStatus } from '../common/enums/driver-status.enum';

export interface SelectableDriverResult {
  driverUserId: string;
  firstName: string;
  lastName: string;
  rating: number;
  level: DriverProfile['level'];
  distanceKm: number;
  etaMinutes: number;
  vehicleMake: string | null;
  vehicleModel: string | null;
  vehicleColor: string | null;
  vehiclePlateNumber: string | null;
}

@Injectable()
export class RidesService {
  constructor(
    @InjectRepository(Ride)
    private readonly ridesRepo: Repository<Ride>,
    private readonly fareService: FareService,
    private readonly driversService: DriversService,
    private readonly vehiclesService: VehiclesService,
    private readonly walletsService: WalletsService,
    private readonly commissionService: CommissionService,
    private readonly usersService: UsersService,
    private readonly paymentsService: PaymentsService,
    private readonly corporateService: CorporateService,
    private readonly passengersService: PassengersService,
    private readonly promotionsService: PromotionsService,
    private readonly fleetService: FleetService,
    private readonly dispatchService: DispatchService,
    private readonly pricingService: PricingService,
    private readonly events: EventEmitter2,
    private readonly config: ConfigService,
    @InjectQueue('scheduled-rides') private readonly scheduledRidesQueue: Queue,
    private readonly reconciliationService: ReconciliationService,
    private readonly settingsService: SystemSettingsService,
    private readonly metricsService: MetricsService,
    private readonly googleMaps: GoogleMapsService,
  ) {}

  async estimateFare(dto: FareEstimateDto) {
    const surge = await this.pricingService.calculateSurge(dto.city);
    return this.fareService.estimate(
      dto.category,
      { lat: dto.pickupLat, lng: dto.pickupLng },
      { lat: dto.dropoffLat, lng: dto.dropoffLng },
      { isAirportTrip: dto.isAirportTrip, surgeMultiplier: surge.multiplier },
    );
  }

  async requestRide(passengerId: string, dto: RequestRideDto): Promise<Ride> {
    await this.passengersService.assertNotBlacklisted(passengerId);

    const surge = await this.pricingService.calculateSurge(dto.city);
    const breakdown = await this.fareService.estimate(
      dto.category,
      { lat: dto.pickupLat, lng: dto.pickupLng },
      { lat: dto.dropoffLat, lng: dto.dropoffLng },
      { isAirportTrip: dto.isAirportTrip, surgeMultiplier: surge.multiplier },
    );

    const paymentMethod = dto.paymentMethod ?? PaymentMethod.CASH;

    let scheduledAt: Date | null = null;
    if (dto.scheduledAt) {
      scheduledAt = new Date(dto.scheduledAt);
      if (Number.isNaN(scheduledAt.getTime()) || scheduledAt.getTime() <= Date.now()) {
        throw new BadRequestException('scheduledAt must be a valid future date/time');
      }
    }

    // Fail fast if the passenger picked corporate billing but isn't attached
    // to an active corporate account, rather than discovering it at settlement.
    if (paymentMethod === PaymentMethod.CORPORATE) {
      const account = await this.corporateService.getAccountForEmployee(passengerId);
      if (!account) {
        throw new BadRequestException(
          'You are not linked to an active corporate account',
        );
      }
    }

    const ride = this.ridesRepo.create({
      passengerId,
      category: dto.category,
      status: scheduledAt ? RideStatus.SCHEDULED : RideStatus.SEARCHING,
      scheduledAt,
      pickupLat: dto.pickupLat,
      pickupLng: dto.pickupLng,
      pickupAddress: dto.pickupAddress,
      dropoffLat: dto.dropoffLat,
      dropoffLng: dto.dropoffLng,
      dropoffAddress: dto.dropoffAddress,
      city: dto.city ?? null,
      estimatedDistanceKm: breakdown.estimatedDistanceKm,
      estimatedDurationMin: breakdown.estimatedDurationMin,
      baseFare: breakdown.baseFare.toFixed(2),
      distanceFare: breakdown.distanceFare.toFixed(2),
      timeFare: breakdown.timeFare.toFixed(2),
      surgeMultiplier: breakdown.surgeMultiplier.toFixed(2),
      nightMultiplierApplied: breakdown.nightMultiplierApplied.toFixed(2),
      airportFee: breakdown.airportFee.toFixed(2),
      isAirportTrip: !!dto.isAirportTrip,
      flightNumber: dto.flightNumber ?? null,
      usedRealRouting: breakdown.usedRealRouting,
      tollFare: breakdown.tollFare.toFixed(2),
      discount: breakdown.discount.toFixed(2),
      totalFare: breakdown.totalFare.toFixed(2),
      paymentMethod,
      verificationPin: String(Math.floor(1000 + Math.random() * 9000)),
    });

    const savedRide = await this.ridesRepo.save(ride);
    this.events.emit('ride.created', { rideId: savedRide.id, passengerId: savedRide.passengerId });
    this.metricsService.rideRequestsTotal.inc({ category: dto.category });

    if (dto.promoCode) {
      const preview = await this.promotionsService.redeem(
        dto.promoCode,
        passengerId,
        savedRide.id,
        parseFloat(savedRide.totalFare),
      );
      // Upfront discounts (percentage/fixed) reduce the fare right away;
      // cashback-type promos don't touch the fare — they pay out after
      // completion via settleCashbackForRide().
      if (preview.appliesUpfront) {
        savedRide.discount = preview.discountAmount.toFixed(2);
        savedRide.totalFare = this.round(
          parseFloat(savedRide.totalFare) - preview.discountAmount,
        ).toFixed(2);
        await this.ridesRepo.save(savedRide);
      }
    }

    if (scheduledAt) {
      // Delayed job — fires shortly before the requested pickup time to
      // flip the ride to searching and kick off normal dispatch. Real
      // BullMQ delayed job, not a polling loop.
      const leadMinutes = this.config.get<number>('dispatch.scheduledRideLeadMinutes')!;
      const activateAt = scheduledAt.getTime() - leadMinutes * 60 * 1000;
      const delay = Math.max(0, activateAt - Date.now());

      await this.scheduledRidesQueue.add(
        'activate',
        { rideId: savedRide.id },
        { delay, jobId: `activate-${savedRide.id}` },
      );
    }
    // No automatic dispatch here anymore — the passenger picks a driver
    // themselves from the nearby-drivers list (GET /rides/:id/nearby-drivers)
    // and targets them explicitly (POST /rides/:id/select-driver). The ride
    // just sits SEARCHING until they do. See dispatch.service.ts for why
    // the old auto-pick-nearest behavior was removed as the primary flow.

    return savedRide;
  }

  async findById(id: string): Promise<Ride> {
    const ride = await this.ridesRepo.findOne({ where: { id } });
    if (!ride) throw new NotFoundException('Ride not found');
    return ride;
  }

  /** See RidesController.forceStatus() for why this exists and its intentional limitations. */
  async forceStatusForAdmin(id: string, status: RideStatus): Promise<Ride> {
    const ride = await this.findById(id);
    ride.status = status;
    const saved = await this.ridesRepo.save(ride);

    // The normal completion/cancellation flows reset the driver back to
    // ONLINE as a side effect — this endpoint skipped that entirely by
    // design (see the controller's docs on why it stays minimal), which
    // meant a driver whose stuck ride got force-fixed stayed
    // permanently stuck showing ON_TRIP regardless. Terminal statuses
    // specifically need this: there's no other path that will ever
    // un-stick them once the ride itself is no longer active.
    const terminalStatuses = [RideStatus.CANCELLED, RideStatus.COMPLETED];
    if (terminalStatuses.includes(status) && ride.driverId) {
      await this.driversService.setAvailability(ride.driverId, DriverAvailability.ONLINE).catch(() => undefined);
    }

    return saved;
  }

  /**
   * Real gap found while building the admin dashboard's ride list, not
   * assumed: `GET /rides/:id` had zero ownership check beyond being
   * logged in — any authenticated passenger could view any other ride's
   * full details (fare, addresses, everyone involved) just by knowing or
   * guessing the ID. `findById()` itself stays a bare internal helper
   * (every other caller — accept/arrived/start/complete/cancel/etc. —
   * does its own separate authorization appropriate to that action), so
   * this wraps it with the same isParticipant-or-staff check already
   * used by getDriverInfo/getPassengerInfo/getRoute, specifically for
   * the controller's direct "fetch one ride" endpoint.
   */
  async getForUser(rideId: string, requesterId: string, requesterRole: UserRole): Promise<Ride> {
    const ride = await this.findById(rideId);
    let isParticipant = ride.passengerId === requesterId || ride.driverId === requesterId;
    if (!isParticipant && requesterRole === UserRole.DRIVER) {
      // ride.driverId only gets set on acceptance — a driver viewing
      // their own offer screen (to see pickup/dropoff/fare *before*
      // deciding whether to accept) isn't covered by the check above at
      // all. Real bug found from a live report: this produced a 403 on
      // a completely valid, pending offer, surfacing as "Unable to load
      // this ride offer" for a driver who had every right to see it.
      const pendingOffer = await this.dispatchService.getMyPendingOffer(rideId, requesterId);
      isParticipant = !!pendingOffer;
    }
    const isStaff = STAFF_ROLES.includes(requesterRole);
    if (!isParticipant && !isStaff) {
      throw new ForbiddenException("You don't have access to this ride");
    }
    return ride;
  }

  /**
   * Admin ride list/search — same gap as DriversService.listForAdmin()
   * before it: nothing let staff look up a specific ride at all, only
   * `GET /rides/mine` (self) and `GET /rides/:id` (needs the exact ID
   * already). Support agents need this constantly. Same lightweight
   * query-builder join pattern as the driver list and AnalyticsService,
   * joining User twice (once per role) rather than adding new service
   * dependencies just for names.
   */
  async listForAdmin(filter?: { status?: RideStatus; search?: string }, page = 1, limit = 25) {
    const qb = this.ridesRepo
      .createQueryBuilder('ride')
      .leftJoin(User, 'passenger', 'passenger.id::text = ride.passengerId')
      .leftJoin(User, 'driver', 'driver.id::text = ride.driverId')
      .select('ride.id', 'id')
      .addSelect('ride.status', 'status')
      .addSelect('ride.pickupAddress', 'pickupAddress')
      .addSelect('ride.dropoffAddress', 'dropoffAddress')
      .addSelect('ride.city', 'city')
      .addSelect('ride.totalFare', 'totalFare')
      .addSelect('ride.paymentMethod', 'paymentMethod')
      .addSelect('ride.createdAt', 'createdAt')
      .addSelect('passenger.firstName', 'passengerFirstName')
      .addSelect('passenger.lastName', 'passengerLastName')
      .addSelect('passenger.phone', 'passengerPhone')
      .addSelect('driver.firstName', 'driverFirstName')
      .addSelect('driver.lastName', 'driverLastName')
      .addSelect('driver.phone', 'driverPhone')
      .orderBy('ride.createdAt', 'DESC');

    if (filter?.status) {
      qb.andWhere('ride.status = :status', { status: filter.status });
    }
    if (filter?.search) {
      // Matches a ride ID prefix, or either party's name/phone — covers
      // the realistic ways a support agent would actually be searching
      // ("that ride for +234...", "the one for Ada Bello").
      qb.andWhere(
        `(CAST(ride.id AS TEXT) ILIKE :search
          OR passenger."firstName" ILIKE :search OR passenger."lastName" ILIKE :search OR passenger.phone ILIKE :search
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
   * Gives the passenger visibility into who's actually picking them up —
   * name, photo, rating, and vehicle details. Previously nothing exposed
   * this: `Ride` only stored a raw `driverId`/`vehicleId`, and no
   * endpoint joined them into anything a passenger UI could show. Scoped
   * to the ride's own passenger (or staff) — not a general "look up any
   * driver" endpoint.
   */
  async getDriverInfo(rideId: string, requesterId: string, requesterRole: UserRole) {
    const ride = await this.findById(rideId);

    const isPassenger = ride.passengerId === requesterId;
    const isStaff = STAFF_ROLES.includes(requesterRole);
    if (!isPassenger && !isStaff) {
      throw new ForbiddenException("You don't have access to this ride");
    }

    if (!ride.driverId) return null;

    const [driverUser, driverProfile, vehicle] = await Promise.all([
      this.usersService.findById(ride.driverId),
      this.driversService.findByUserId(ride.driverId),
      ride.vehicleId ? this.vehiclesService.findById(ride.vehicleId) : Promise.resolve(null),
    ]);

    return {
      firstName: driverUser.firstName,
      lastName: driverUser.lastName,
      // Exposed plainly, not masked — this deployment has no telephony
      // proxy (e.g. Twilio Connect) to issue a temporary masked number
      // for the duration of a ride. A real production rollout in a
      // market where driver privacy matters would want that; documented
      // as a known gap rather than silently shipping a fake mask.
      phone: driverUser.phone,
      profilePhotoUrl: driverUser.profilePhotoUrl,
      rating: driverProfile.rating,
      completedTrips: driverProfile.completedTrips,
      level: driverProfile.level,
      vehicle: vehicle
        ? {
            make: vehicle.make,
            model: vehicle.model,
            color: vehicle.color,
            plateNumber: vehicle.plateNumber,
          }
        : null,
    };
  }

  /**
   * The reverse of getDriverInfo — a driver on an accepted ride
   * previously had no way to see who their passenger even was, let alone
   * call them. Same access pattern, same plain-phone caveat (no
   * telephony proxy in this deployment).
   */
  async getPassengerInfo(rideId: string, requesterId: string, requesterRole: UserRole) {
    const ride = await this.findById(rideId);

    const isDriver = ride.driverId === requesterId;
    const isStaff = STAFF_ROLES.includes(requesterRole);
    if (!isDriver && !isStaff) {
      throw new ForbiddenException("You don't have access to this ride");
    }

    const passengerUser = await this.usersService.findById(ride.passengerId);

    return {
      firstName: passengerUser.firstName,
      lastName: passengerUser.lastName,
      phone: passengerUser.phone,
      profilePhotoUrl: passengerUser.profilePhotoUrl,
    };
  }

  /** Idempotent — returns the existing token if one was already generated for this ride. */
  async getOrCreateShareToken(rideId: string, requesterId: string): Promise<{ shareToken: string }> {
    const ride = await this.findById(rideId);
    if (ride.passengerId !== requesterId) {
      throw new ForbiddenException('Only the passenger can share this ride');
    }

    if (!ride.shareToken) {
      ride.shareToken = randomUUID();
      await this.ridesRepo.save(ride);
    }
    return { shareToken: ride.shareToken };
  }

  /**
   * Deliberately unauthenticated (see the controller) — this is for
   * someone the passenger shares a link with who doesn't have a Ryda
   * account. Only safety-relevant, non-sensitive fields are returned:
   * no passenger name/phone, no fare, no payment details.
   */
  async getSharedRideView(shareToken: string) {
    const ride = await this.ridesRepo.findOne({ where: { shareToken } });
    if (!ride) throw new NotFoundException('Shared trip not found');

    const driverInfo = ride.driverId
      ? await this.getDriverInfo(ride.id, ride.passengerId, UserRole.PASSENGER)
      : null;

    return {
      status: ride.status,
      pickupAddress: ride.pickupAddress,
      dropoffAddress: ride.dropoffAddress,
      pickupLat: ride.pickupLat,
      pickupLng: ride.pickupLng,
      dropoffLat: ride.dropoffLat,
      dropoffLng: ride.dropoffLng,
      driver: driverInfo
        ? { firstName: driverInfo.firstName, vehicle: driverInfo.vehicle, rating: driverInfo.rating }
        : null,
    };
  }

  /**
   * Real routed polyline for the map — returns null when Google isn't
   * configured (Nominatim has no routing capability at all, it's
   * geocoding-only) so the app keeps falling back to its existing
   * straight-line placeholder rather than erroring. Computed on demand
   * rather than stored at ride-creation time: only actually needed once
   * someone opens a map view for this ride, not on every fare estimate,
   * so this avoids an extra Directions API call for rides nobody ever
   * looks at on a map.
   */
  async getRoute(rideId: string, requesterId: string, requesterRole: UserRole) {
    const ride = await this.findById(rideId);

    const isParticipant = ride.passengerId === requesterId || ride.driverId === requesterId;
    const isStaff = STAFF_ROLES.includes(requesterRole);
    if (!isParticipant && !isStaff) {
      throw new ForbiddenException("You don't have access to this ride");
    }

    if (!this.googleMaps.isConfigured()) return null;

    const directions = await this.googleMaps.getDirections(
      { lat: ride.pickupLat, lng: ride.pickupLng },
      { lat: ride.dropoffLat, lng: ride.dropoffLng },
    );
    if (!directions?.polyline) return null;

    return { points: decodePolyline(directions.polyline) };
  }

  /**
   * Called by the driver at pickup — a lightweight anti-fraud check that
   * they're picking up the actual matched passenger. Deliberately NOT
   * wired as a hard gate on `start()` (i.e. a wrong/missing PIN doesn't
   * block the trip) — that would touch the already-tested core lifecycle
   * for a feature that should stay opt-in extra assurance, not a new
   * failure mode for a driver who forgets to ask.
   */
  async verifyPin(rideId: string, driverId: string, pin: string): Promise<{ verified: boolean }> {
    const ride = await this.findById(rideId);
    if (ride.driverId !== driverId) {
      throw new ForbiddenException("You're not the driver on this ride");
    }
    const verified = ride.verificationPin === pin;
    if (verified && !ride.isPinVerified) {
      ride.isPinVerified = true;
      await this.ridesRepo.save(ride);
    }
    return { verified };
  }

  /**
   * Tipping happens after the trip, from the passenger's own wallet to
   * the driver's — separate from the ride's own fare settlement
   * (`completeRide()`), which is already closed out by the time a tip
   * makes sense to add.
   */
  async addTip(rideId: string, passengerId: string, amount: number): Promise<Ride> {
    if (amount <= 0) throw new BadRequestException('Tip amount must be positive');

    const ride = await this.findById(rideId);
    if (ride.passengerId !== passengerId) {
      throw new ForbiddenException("You're not the passenger on this ride");
    }
    if (ride.status !== RideStatus.COMPLETED) {
      throw new BadRequestException('You can only tip after the trip is completed');
    }
    if (!ride.driverId) {
      throw new BadRequestException('This ride has no driver to tip');
    }
    if (parseFloat(ride.tipAmount) > 0) {
      throw new BadRequestException('You already tipped this trip');
    }

    const passengerWallet = await this.walletsService.getByUserId(passengerId);
    const driverWallet = await this.walletsService.getByUserId(ride.driverId);

    await this.walletsService.debit(passengerWallet.id, amount, TransactionCategory.TIP_PAYMENT, ride.id, 'Driver tip');
    await this.walletsService.credit(driverWallet.id, amount, TransactionCategory.TIP_RECEIVED, ride.id, 'Tip received');

    ride.tipAmount = amount.toFixed(2);
    return this.ridesRepo.save(ride);
  }

  async findForPassenger(passengerId: string): Promise<Ride[]> {
    return this.ridesRepo.find({
      where: { passengerId },
      order: { createdAt: 'DESC' },
    });
  }

  async findScheduledForPassenger(passengerId: string): Promise<Ride[]> {
    return this.ridesRepo.find({
      where: { passengerId, status: RideStatus.SCHEDULED },
      order: { scheduledAt: 'ASC' },
    });
  }

  /** Called by ScheduledRideProcessor when a delayed activation job fires. */
  async activateScheduledRide(rideId: string): Promise<void> {
    const ride = await this.ridesRepo.findOne({ where: { id: rideId } });
    if (!ride || ride.status !== RideStatus.SCHEDULED) return; // already cancelled or handled

    ride.status = RideStatus.SEARCHING;
    await this.ridesRepo.save(ride);
    // No auto-dispatch — same reasoning as requestRide() above. The
    // passenger picks a driver from the list once the ride activates.
  }

  async findForDriver(driverId: string): Promise<Ride[]> {
    return this.ridesRepo.find({
      where: { driverId },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Lists online, approved drivers near a ride's pickup point, nearest first.
   * Backs the dispatch console's "who's nearby" view (Smart Dispatch Engine).
   */
  async findNearbyDrivers(rideId: string, radiusKm?: number): Promise<NearbyDriverResult[]> {
    const ride = await this.findById(rideId);
    return this.driversService.findNearby(
      { lat: ride.pickupLat, lng: ride.pickupLng },
      { city: ride.city ?? undefined, radiusKm },
    );
  }

  /**
   * The passenger-facing version, for actually choosing a driver rather
   * than an internal ops view — needs a name and vehicle to be
   * meaningful to a passenger, which findNearbyDrivers() above
   * deliberately doesn't include (kept lean for its one existing
   * caller, the dispatch console).
   *
   * ETA is a straight-line-distance estimate, not real routing — this
   * environment has no Google Directions key configured, and even where
   * one is, calling it per-candidate for a whole list on every refresh
   * would be slow and expensive. 28 km/h is a reasonable average urban
   * driving speed assumption for a Lagos-style city; genuinely
   * traffic-aware ETA is what the ride-tracking screen's real routing
   * (already built, uses Directions when configured) is for, once
   * there's a single specific driver to route to.
   */
  async findSelectableDrivers(rideId: string): Promise<SelectableDriverResult[]> {
    const ride = await this.findById(rideId);
    const candidates = await this.driversService.findNearby(
      { lat: ride.pickupLat, lng: ride.pickupLng },
      { city: ride.city ?? undefined, limit: 20 },
    );
    if (candidates.length === 0) return [];

    const ASSUMED_AVG_SPEED_KMH = 28;

    const userIds = candidates.map((c) => c.userId);
    const vehicleIds = candidates.map((c) => c.vehicleId).filter((v): v is string => !!v);
    const [users, vehicles] = await Promise.all([
      this.usersService.findByIds(userIds),
      Promise.all(vehicleIds.map((id) => this.vehiclesService.findById(id).catch(() => null))),
    ]);
    const userById = new Map(users.map((u) => [u.id, u]));
    const vehicleById = new Map(vehicles.filter((v): v is NonNullable<typeof v> => !!v).map((v) => [v.id, v]));

    return candidates.map((c) => {
      const user = userById.get(c.userId);
      const vehicle = c.vehicleId ? vehicleById.get(c.vehicleId) : undefined;
      return {
        driverUserId: c.userId,
        firstName: user?.firstName ?? 'Driver',
        lastName: user?.lastName ?? '',
        rating: c.rating,
        level: c.level,
        distanceKm: c.distanceKm,
        etaMinutes: Math.max(1, Math.round((c.distanceKm / ASSUMED_AVG_SPEED_KMH) * 60)),
        vehicleMake: vehicle?.make ?? null,
        vehicleModel: vehicle?.model ?? null,
        vehicleColor: vehicle?.color ?? null,
        vehiclePlateNumber: vehicle?.plateNumber ?? null,
      };
    });
  }

  /**
   * The passenger targets a specific driver directly — no "nearest"
   * ranking involved, this is their explicit choice. Any previous
   * pending offer for this ride (from an earlier selection that expired
   * or was declined) is superseded first, so there's never more than
   * one live offer per ride — the exclusivity check in acceptRide()
   * below depends on that being true.
   */
  async selectDriver(rideId: string, passengerId: string, driverUserId: string): Promise<void> {
    const ride = await this.findById(rideId);
    if (ride.passengerId !== passengerId) throw new ForbiddenException('This is not your ride');
    if (ride.status !== RideStatus.SEARCHING) {
      throw new BadRequestException(`Cannot select a driver while the ride is ${ride.status}`);
    }

    const driverProfile = await this.driversService.findByUserId(driverUserId);
    if (driverProfile.approvalStatus !== DriverApprovalStatus.APPROVED) {
      throw new BadRequestException('This driver is not currently available.');
    }
    if (driverProfile.availability !== DriverAvailability.ONLINE) {
      throw new BadRequestException('This driver is no longer online — pick another from the list.');
    }

    await this.dispatchService.offerToSpecificDriver(rideId, driverUserId);
  }

  /**
   * Called from the passenger's "Choose someone else instead" — a real
   * backend effect, not just a UI state change. Without this, a driver
   * the passenger has moved on from still had a genuinely pending
   * offer and could still accept the ride. Deliberately lenient on
   * ride ownership/status here: this is meant to be safe to call
   * defensively, and superseding zero rows (e.g. the offer already
   * expired) is a harmless no-op, not an error worth surfacing.
   */
  async withdrawCurrentOffer(rideId: string, passengerId: string): Promise<void> {
    const ride = await this.findById(rideId);
    if (ride.passengerId !== passengerId) throw new ForbiddenException('This is not your ride');
    await this.dispatchService.withdrawOffer(rideId);
  }

  async acceptRide(rideId: string, driverUserId: string): Promise<Ride> {
    const ride = await this.findById(rideId);
    if (ride.status !== RideStatus.SEARCHING && ride.status !== RideStatus.REQUESTED) {
      throw new BadRequestException(`Ride cannot be accepted from status ${ride.status}`);
    }

    // If the passenger has a pending offer out to a specific driver,
    // only that driver may accept — otherwise a different driver could
    // swoop in via broadcast-accept while the chosen one is still
    // deciding, which would defeat the entire point of letting the
    // passenger pick. No pending offer at all (nobody's been selected
    // yet) still allows the plain broadcast-accept path below.
    const pendingOffer = await this.dispatchService.getPendingOfferForRide(rideId);
    if (pendingOffer) {
      if (pendingOffer.driverUserId !== driverUserId) {
        throw new ForbiddenException('This ride is currently offered to another driver.');
      }
    } else if (await this.dispatchService.hasEverHadOffer(rideId)) {
      // An offer existed for this ride but isn't live anymore (expired,
      // withdrawn, or declined) — block acceptance outright, not just
      // for other drivers. Falling through to open acceptance here
      // would let the exact driver whose own offer just expired accept
      // anyway, which defeats the point of the exclusivity check above.
      throw new BadRequestException('This offer is no longer available — ask the passenger to select a driver again.');
    }
    // else: this ride has never been offered to anyone at all — the
    // open broadcast-accept path (offerToNearestDriver(), kept but
    // unused by default) remains valid for that case.

    const driverProfile = await this.driversService.findByUserId(driverUserId);
    if (driverProfile.approvalStatus !== DriverApprovalStatus.APPROVED) {
      throw new ForbiddenException('Driver is not approved');
    }
    if (driverProfile.availability !== DriverAvailability.ONLINE) {
      throw new BadRequestException('Driver must be online to accept rides');
    }

    // Only cash (and bank-transfer-collected, once that exists) rides
    // accumulate this kind of debt — a driver whose commission couldn't
    // be deducted from their wallet at completion time. Checking here,
    // not requiring a flat minimum balance at all times, means a driver
    // having one cash-heavy day isn't punished; only genuinely
    // accumulating, unpaid debt restricts them, and only past a
    // threshold an admin can adjust without a redeploy — see
    // SETTING_KEYS.MAX_CASH_DEBT_BEFORE_RESTRICTION.
    if (ride.paymentMethod === PaymentMethod.CASH) {
      const maxDebt = await this.settingsService.getNumber(SETTING_KEYS.MAX_CASH_DEBT_BEFORE_RESTRICTION, 5000);
      const { totalOwed } = await this.reconciliationService.getOutstandingBalance(driverUserId);
      if (parseFloat(totalOwed) >= maxDebt) {
        throw new BadRequestException(
          `You have ₦${totalOwed} in unpaid commission from cash trips — pay this down or top up your wallet before accepting another cash ride.`,
        );
      }
    }

    ride.driverId = driverUserId;
    ride.vehicleId = driverProfile.activeVehicleId;
    ride.status = RideStatus.ACCEPTED;
    ride.acceptedAt = new Date();
    await this.driversService.setAvailability(driverUserId, DriverAvailability.ON_TRIP);

    const saved = await this.ridesRepo.save(ride);

    const driver = await this.usersService.findById(driverUserId);
    this.events.emit('ride.accepted', {
      passengerId: saved.passengerId,
      driverName: driver.firstName,
    });

    // Best-effort — marks this driver's offer (if any) accepted and
    // supersedes any other pending offers for this ride. Works the same
    // whether this driver came in via a dispatch offer or the plain
    // broadcast-accept path.
    await this.dispatchService.markAccepted(rideId, driverUserId).catch(() => undefined);

    return saved;
  }

  async markArrived(rideId: string, driverUserId: string): Promise<Ride> {
    const ride = await this.getOwnedByDriver(rideId, driverUserId);
    if (ride.status !== RideStatus.ACCEPTED) {
      throw new BadRequestException('Ride must be accepted before marking arrival');
    }
    ride.status = RideStatus.ARRIVED;
    ride.arrivedAt = new Date();
    return this.ridesRepo.save(ride);
  }

  async startRide(rideId: string, driverUserId: string): Promise<Ride> {
    const ride = await this.getOwnedByDriver(rideId, driverUserId);
    if (ride.status !== RideStatus.ARRIVED && ride.status !== RideStatus.ACCEPTED) {
      throw new BadRequestException('Ride must be accepted/arrived before starting');
    }
    ride.status = RideStatus.IN_PROGRESS;
    ride.startedAt = new Date();

    if (ride.arrivedAt) {
      const waitingFee = this.fareService.calculateWaitingFee(ride.arrivedAt, ride.startedAt);
      if (waitingFee > 0) {
        ride.waitingFee = waitingFee.toFixed(2);
        ride.totalFare = this.round(parseFloat(ride.totalFare) + waitingFee).toFixed(2);
      }
    }

    const saved = await this.ridesRepo.save(ride);
    this.events.emit('ride.started', { rideId: saved.id, driverId: driverUserId });
    return saved;
  }

  /**
   * Completes the trip and settles money based on payment method:
   *  - wallet: passenger's wallet is debited the full fare, driver's wallet
   *    is credited fare minus commission.
   *  - cash: the driver already collected cash directly, so only the
   *    platform commission is debited from the driver's wallet.
   *  - card / bank_transfer: settled via PaymentsService (simulated gateway
   *    charge) against the passenger; driver's wallet is credited earnings,
   *    same as wallet payment, since the platform receives the funds.
   *  - corporate: the rider's linked CorporateAccount budget is debited the
   *    full fare instead of a personal wallet; driver earnings settle the
   *    same way.
   */
  async completeRide(rideId: string, driverUserId: string): Promise<Ride> {
    const ride = await this.getOwnedByDriver(rideId, driverUserId);
    if (ride.status !== RideStatus.IN_PROGRESS) {
      throw new BadRequestException('Ride must be in progress to complete');
    }

    const driverProfile = await this.driversService.findByUserId(driverUserId);
    const vehicleCategory = driverProfile.activeVehicleId
      ? (await this.vehiclesService.findById(driverProfile.activeVehicleId)).category
      : undefined;

    const commissionPercent =
      driverProfile.commissionOverridePercent != null
        ? parseFloat(driverProfile.commissionOverridePercent)
        : await this.commissionService.resolveCommissionPercent({
            driverLevel: driverProfile.level,
            vehicleCategory,
            city: ride.city ?? undefined,
          });

    const totalFare = parseFloat(ride.totalFare);
    const commissionAmount = this.round(totalFare * (commissionPercent / 100));
    const driverEarnings = this.round(totalFare - commissionAmount);

    ride.status = RideStatus.COMPLETED;
    ride.completedAt = new Date();
    ride.commissionPercent = commissionPercent.toFixed(2);
    ride.commissionAmount = commissionAmount.toFixed(2);
    ride.driverEarnings = driverEarnings.toFixed(2);
    await this.ridesRepo.save(ride);

    try {
      if (ride.paymentMethod === PaymentMethod.WALLET) {
        const passengerWallet = await this.walletsService.getByUserId(ride.passengerId);
        await this.walletsService.debit(
          passengerWallet.id,
          totalFare,
          TransactionCategory.RIDE_PAYMENT,
          ride.id,
          `Ride payment for trip ${ride.id}`,
        );
        await this.creditDriverEarnings(ride, driverProfile, driverEarnings, commissionPercent);
      } else if (ride.paymentMethod === PaymentMethod.CASH) {
        // Fleet drivers still collect cash directly, but the commission they
        // owe comes out of the fleet's wallet, not their personal one — the
        // fleet is the counterparty the platform actually settles with.
        // If the wallet can't cover it right now, the ride still completes —
        // the shortfall becomes a tracked debt (ReconciliationService) that
        // auto-settles the next time that wallet is credited, rather than
        // blocking a driver from finishing a trip over an accounting gap.
        if (driverProfile.fleetCompanyId) {
          try {
            await this.fleetService.debitFleetCommission(driverProfile.fleetCompanyId, commissionAmount, ride.id);
          } catch {
            await this.reconciliationService.recordDebt(null, driverProfile.fleetCompanyId, ride.id, commissionAmount);
          }
        } else {
          const driverWallet = await this.walletsService.getByUserId(driverUserId);
          try {
            await this.walletsService.debit(
              driverWallet.id,
              commissionAmount,
              TransactionCategory.COMMISSION,
              ride.id,
              `Commission owed on cash trip ${ride.id} (${commissionPercent}%)`,
            );
          } catch {
            await this.reconciliationService.recordDebt(driverUserId, null, ride.id, commissionAmount);
          }
        }
        ride.earningsSettled = true;
        await this.ridesRepo.save(ride);
      } else if (ride.paymentMethod === PaymentMethod.CARD) {
        const passenger = await this.usersService.findById(ride.passengerId);
        if (!passenger.email) {
          throw new BadRequestException('Add an email to your account before paying by card');
        }
        const payment = await this.paymentsService.chargeSavedCard(
          ride.id,
          ride.passengerId,
          passenger.email,
          totalFare,
        );
        if (payment.status !== PaymentStatus.SUCCESS) {
          const reason = payment.failureReason ?? 'Card payment failed — trip cannot be completed';
          this.events.emit('payment.failed', { userId: ride.passengerId, reason });
          throw new BadRequestException(reason);
        }
        // Synchronous charge — settle immediately, same as wallet.
        await this.creditDriverEarnings(ride, driverProfile, driverEarnings, commissionPercent);
      } else if (ride.paymentMethod === PaymentMethod.BANK_TRANSFER) {
        const passenger = await this.usersService.findById(ride.passengerId);
        if (!passenger.email) {
          throw new BadRequestException('Add an email to your account before paying by bank transfer');
        }
        // Asynchronous — driver earnings are NOT credited yet. See
        // handlePaymentConfirmed(), triggered by the Paystack webhook once
        // the transfer actually lands.
        await this.paymentsService.initBankTransfer(ride.id, ride.passengerId, passenger.email, totalFare);
      } else if (ride.paymentMethod === PaymentMethod.CORPORATE) {
        const account = await this.corporateService.getAccountForEmployee(ride.passengerId);
        if (!account) {
          throw new BadRequestException('Passenger is not linked to a corporate account');
        }
        await this.corporateService.debitForRide(account.id, totalFare, ride.id);
        await this.creditDriverEarnings(ride, driverProfile, driverEarnings, commissionPercent);
      }
    } catch (err) {
      // Real bug found from a live report: without this, a payment
      // failure here (e.g. insufficient wallet balance) left the ride
      // permanently stuck marked COMPLETED in the database with no
      // payment ever processed — the driver's app only saw a failed
      // request and had no way to know the underlying status had
      // already changed. Reverting puts the ride back in a genuinely
      // consistent, retryable state: still IN_PROGRESS, safe to
      // complete again once whatever failed (e.g. a wallet top-up) is
      // resolved, rather than silently stuck in an inconsistent state
      // that needed a manual database fix to recover from.
      ride.status = RideStatus.IN_PROGRESS;
      ride.completedAt = null;
      ride.commissionPercent = null;
      ride.commissionAmount = null;
      ride.driverEarnings = null;
      await this.ridesRepo.save(ride);
      throw err;
    }

    await this.driversService.recordTripOutcome(driverProfile.id, 'completed');
    await this.driversService.setAvailability(driverUserId, DriverAvailability.ONLINE);
    await this.passengersService.recordTripOutcome(ride.passengerId, 'completed', totalFare);
    await this.promotionsService.settleCashbackForRide(ride.id, ride.passengerId);
    await this.promotionsService.grantReferralBonusIfEligible(ride.passengerId);

    this.events.emit('ride.completed', {
      passengerId: ride.passengerId,
      driverId: driverUserId,
      totalFare: ride.totalFare,
    });
    this.metricsService.rideCompletionsTotal.inc({ paymentMethod: ride.paymentMethod });

    return ride;
  }

  /**
   * Credits driver earnings and marks the ride as settled. If the driver
   * belongs to a fleet, earnings go to the fleet's wallet instead of a
   * personal one — the platform's counterparty is the fleet, not the
   * individual driver. Called synchronously for wallet/card/corporate;
   * called later, from handlePaymentConfirmed(), for bank_transfer.
   */
  private async creditDriverEarnings(
    ride: Ride,
    driverProfile: DriverProfile,
    driverEarnings: number,
    commissionPercent: number,
  ): Promise<void> {
    if (driverProfile.fleetCompanyId) {
      await this.fleetService.creditForRideEarning(driverProfile.fleetCompanyId, driverEarnings, ride.id);
    } else {
      const driverWallet = await this.walletsService.getByUserId(driverProfile.userId);
      await this.walletsService.credit(
        driverWallet.id,
        driverEarnings,
        TransactionCategory.RIDE_EARNING,
        ride.id,
        `Earnings for trip ${ride.id} (commission ${commissionPercent}%)`,
      );
    }
    ride.earningsSettled = true;
    await this.ridesRepo.save(ride);
  }

  /**
   * Listens for payment.confirmed, emitted by PaymentsService when the
   * Paystack webhook confirms a bank_transfer payment. Credits the driver
   * (or their fleet) at that point — this is the only payment method where
   * completeRide() doesn't settle synchronously.
   */
  @OnEvent('payment.confirmed')
  async handlePaymentConfirmed(payload: { rideId: string; paymentRecordId: string }): Promise<void> {
    const ride = await this.ridesRepo.findOne({ where: { id: payload.rideId } });
    if (!ride || ride.earningsSettled || !ride.driverId || !ride.driverEarnings) return;
    if (ride.paymentMethod !== PaymentMethod.BANK_TRANSFER) return;

    const driverProfile = await this.driversService.findByUserId(ride.driverId);
    await this.creditDriverEarnings(
      ride,
      driverProfile,
      parseFloat(ride.driverEarnings),
      parseFloat(ride.commissionPercent ?? '0'),
    );
  }

  async cancelRide(
    rideId: string,
    actorUserId: string,
    cancelledBy: CancelledBy,
    dto: CancelRideDto,
  ): Promise<Ride> {
    const ride = await this.findById(rideId);

    if (cancelledBy === CancelledBy.PASSENGER && ride.passengerId !== actorUserId) {
      throw new ForbiddenException('Not your ride');
    }
    if (cancelledBy === CancelledBy.DRIVER && ride.driverId !== actorUserId) {
      throw new ForbiddenException('Not your ride');
    }
    if (
      ride.status === RideStatus.COMPLETED ||
      ride.status === RideStatus.CANCELLED
    ) {
      throw new BadRequestException(`Ride cannot be cancelled from status ${ride.status}`);
    }

    if (ride.status === RideStatus.SCHEDULED) {
      const job = await this.scheduledRidesQueue.getJob(`activate-${ride.id}`);
      await job?.remove().catch(() => undefined);
    }

    // A driver was already engaged (en route or arrived) — the passenger
    // cancelling now costs them real time, so a cancellation fee applies.
    const driverWasEngaged = [
      RideStatus.ACCEPTED,
      RideStatus.ARRIVING,
      RideStatus.ARRIVED,
    ].includes(ride.status);

    ride.status = RideStatus.CANCELLED;
    ride.cancelledAt = new Date();
    ride.cancelledBy = cancelledBy;
    ride.cancelReason = dto.reason ?? null;

    if (
      cancelledBy === CancelledBy.PASSENGER &&
      driverWasEngaged &&
      ride.driverId &&
      ride.paymentMethod === PaymentMethod.WALLET
    ) {
      // Wallet-only for now — charging a cancellation fee via card/bank
      // transfer would need its own gateway call, same shape as ride
      // settlement but not wired up yet (see Known gaps).
      const fee = await this.fareService.getCancellationFee();
      try {
        const passengerWallet = await this.walletsService.getByUserId(ride.passengerId);
        await this.walletsService.debit(
          passengerWallet.id,
          fee,
          TransactionCategory.CANCELLATION_FEE,
          ride.id,
          `Cancellation fee for trip ${ride.id}`,
        );
        ride.cancellationFee = fee.toFixed(2);

        const driverProfile = await this.driversService.findByUserId(ride.driverId);
        if (driverProfile.fleetCompanyId) {
          await this.fleetService.creditForRideEarning(driverProfile.fleetCompanyId, fee, ride.id);
        } else {
          const driverWallet = await this.walletsService.getByUserId(ride.driverId);
          await this.walletsService.credit(
            driverWallet.id,
            fee,
            TransactionCategory.CANCELLATION_FEE,
            ride.id,
            `Cancellation compensation for trip ${ride.id}`,
          );
        }
      } catch {
        // Insufficient wallet balance — the ride still cancels, it just
        // doesn't collect a fee this time (matches the same tolerance the
        // cash-commission flow has for underfunded wallets).
      }
    }

    await this.ridesRepo.save(ride);

    if (ride.driverId) {
      const driverProfile = await this.driversService.findByUserId(ride.driverId);
      await this.driversService.recordTripOutcome(driverProfile.id, 'cancelled');
      await this.driversService.setAvailability(ride.driverId, DriverAvailability.ONLINE);
    }
    await this.passengersService.recordTripOutcome(ride.passengerId, 'cancelled');

    // Notify whichever party DIDN'T do the cancelling.
    const notifyUserId = cancelledBy === CancelledBy.PASSENGER ? ride.driverId : ride.passengerId;
    if (notifyUserId) {
      this.events.emit('ride.cancelled', { notifyUserId, reason: ride.cancelReason });
    }
    this.metricsService.rideCancellationsTotal.inc({ cancelledBy });

    return ride;
  }

  /** Passenger rates the driver after a completed trip. */
  async rateDriver(rideId: string, passengerUserId: string, dto: RateRideDto): Promise<Ride> {
    const ride = await this.findById(rideId);
    if (ride.passengerId !== passengerUserId) throw new ForbiddenException('Not your ride');
    if (ride.status !== RideStatus.COMPLETED) {
      throw new BadRequestException('Can only rate a completed ride');
    }
    if (ride.driverRating != null) {
      throw new BadRequestException('This ride has already been rated');
    }
    if (!ride.driverId) throw new BadRequestException('This ride has no driver to rate');

    ride.driverRating = dto.rating;
    ride.driverRatingComment = dto.comment ?? null;
    await this.ridesRepo.save(ride);

    const driverProfile = await this.driversService.findByUserId(ride.driverId);
    await this.driversService.applyRating(driverProfile.id, dto.rating);

    return ride;
  }

  /** Driver rates the passenger after a completed trip. */
  async ratePassenger(rideId: string, driverUserId: string, dto: RateRideDto): Promise<Ride> {
    const ride = await this.getOwnedByDriver(rideId, driverUserId);
    if (ride.status !== RideStatus.COMPLETED) {
      throw new BadRequestException('Can only rate a completed ride');
    }
    if (ride.passengerRating != null) {
      throw new BadRequestException('This ride has already been rated');
    }

    ride.passengerRating = dto.rating;
    ride.passengerRatingComment = dto.comment ?? null;
    await this.ridesRepo.save(ride);

    await this.usersService.applyRating(ride.passengerId, dto.rating);

    return ride;
  }

  private async getOwnedByDriver(rideId: string, driverUserId: string): Promise<Ride> {
    const ride = await this.findById(rideId);
    if (ride.driverId !== driverUserId) {
      throw new ForbiddenException('Not your ride');
    }
    return ride;
  }

  private round(value: number): number {
    return Math.round(value * 100) / 100;
  }
}
