import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, EntityManager } from 'typeorm';
import { DriverProfile } from './entities/driver-profile.entity';
import { DriverAvailabilityLog } from './entities/driver-availability-log.entity';
import { DriverLevel } from '../common/enums/driver-level.enum';
import {
  DriverApprovalStatus,
  DriverAvailability,
} from '../common/enums/driver-status.enum';
import { OnboardDriverDto } from './dto/onboard-driver.dto';
import { haversineDistanceKm } from '../common/utils/geo.util';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { FraudService } from '../fraud/fraud.service';
import { User } from '../users/entities/user.entity';
import { DriverDocumentsService } from './driver-documents.service';

// Trips required to progress to the next level.
const LEVEL_PROGRESSION: { level: DriverLevel; minTrips: number; minRating: number }[] = [
  { level: DriverLevel.ROOKIE, minTrips: 0, minRating: 0 },
  { level: DriverLevel.STANDARD, minTrips: 50, minRating: 4.5 },
  { level: DriverLevel.SILVER, minTrips: 200, minRating: 4.6 },
  { level: DriverLevel.GOLD, minTrips: 500, minRating: 4.7 },
  { level: DriverLevel.PLATINUM, minTrips: 1500, minRating: 4.8 },
  { level: DriverLevel.DIAMOND, minTrips: 4000, minRating: 4.85 },
  { level: DriverLevel.ELITE, minTrips: 10000, minRating: 4.9 },
];

export interface NearbyDriverResult {
  driverProfileId: string;
  userId: string;
  distanceKm: number;
  level: DriverLevel;
  rating: number;
  vehicleId: string | null;
}

@Injectable()
export class DriversService {
  constructor(
    @InjectRepository(DriverProfile)
    private readonly driversRepo: Repository<DriverProfile>,
    @InjectRepository(DriverAvailabilityLog)
    private readonly availabilityLogRepo: Repository<DriverAvailabilityLog>,
    private readonly events: EventEmitter2,
    private readonly fraudService: FraudService,
    private readonly documentsService: DriverDocumentsService,
  ) {}

  async onboard(userId: string, dto: OnboardDriverDto): Promise<DriverProfile> {
    const existing = await this.driversRepo.findOne({ where: { userId } });
    if (existing) throw new BadRequestException('Driver profile already exists');

    const profile = this.driversRepo.create({
      userId,
      licenseNumber: dto.licenseNumber,
      city: dto.city ?? null,
    });
    return this.driversRepo.save(profile);
  }

  async findByUserId(userId: string): Promise<DriverProfile> {
    const profile = await this.driversRepo.findOne({ where: { userId } });
    if (!profile) throw new NotFoundException('Driver profile not found');
    return profile;
  }

  async findById(id: string): Promise<DriverProfile> {
    const profile = await this.driversRepo.findOne({ where: { id } });
    if (!profile) throw new NotFoundException('Driver profile not found');
    return profile;
  }

  async setApprovalStatus(
    driverId: string,
    status: DriverApprovalStatus,
  ): Promise<DriverProfile> {
    const profile = await this.findById(driverId);

    // Real gap this closes: nothing was checking this before - an admin
    // could approve a driver who never uploaded a single document, and
    // they'd immediately be a real, approved driver visible to
    // passengers. Same hasAllRequiredApproved() check already used to
    // gate going online (see setAvailability() below), applied here too
    // since this is the actual moment a driver becomes approved in the
    // first place. Only enforced for the APPROVED transition - an admin
    // can always reject or suspend regardless of document state.
    if (status === DriverApprovalStatus.APPROVED) {
      const documentsApproved = await this.documentsService.hasAllRequiredApproved(profile.id);
      if (!documentsApproved) {
        throw new BadRequestException(
          "This driver can't be approved yet — their license, insurance, and roadworthiness documents all need to be uploaded and approved first.",
        );
      }
    }

    profile.approvalStatus = status;
    const saved = await this.driversRepo.save(profile);

    this.events.emit('driver.approval.changed', {
      userId: saved.userId,
      approved: status === DriverApprovalStatus.APPROVED,
    });

    return saved;
  }

  /**
   * Real, necessary gap this closed: there was no way for an admin to see
   * ANY list of drivers before this — only `GET /drivers/me` (self) and
   * `GET /drivers/admin/documents/pending` (document reviews, a different
   * thing from approval status). An approval queue is one of the most
   * basic things an admin dashboard needs; found missing while building
   * one. Same lightweight join pattern AnalyticsService already uses
   * (raw query builder joining User directly) rather than adding a new
   * service dependency just for this.
   */
  async listForAdmin(filter?: { approvalStatus?: DriverApprovalStatus }) {
    const qb = this.driversRepo
      .createQueryBuilder('driver')
      .leftJoin(User, 'user', 'user.id = driver.userId')
      .select('driver.id', 'id')
      .addSelect('driver.userId', 'userId')
      .addSelect('user.firstName', 'firstName')
      .addSelect('user.lastName', 'lastName')
      .addSelect('user.phone', 'phone')
      .addSelect('user.email', 'email')
      .addSelect('driver.approvalStatus', 'approvalStatus')
      .addSelect('driver.kycStatus', 'kycStatus')
      .addSelect('driver.availability', 'availability')
      .addSelect('driver.city', 'city')
      .addSelect('driver.rating', 'rating')
      .addSelect('driver.completedTrips', 'completedTrips')
      .addSelect('driver.licenseNumber', 'licenseNumber')
      .addSelect('driver.currentLat', 'currentLat')
      .addSelect('driver.currentLng', 'currentLng')
      .addSelect('driver.locationUpdatedAt', 'locationUpdatedAt')
      .addSelect('driver.createdAt', 'createdAt')
      .orderBy('driver.createdAt', 'DESC');

    if (filter?.approvalStatus) {
      qb.where('driver.approvalStatus = :status', { status: filter.approvalStatus });
    }

    return qb.getRawMany();
  }

  async setAvailability(
    userId: string,
    availability: DriverAvailability,
  ): Promise<DriverProfile> {
    const profile = await this.findByUserId(userId);
    if (profile.approvalStatus !== DriverApprovalStatus.APPROVED) {
      throw new BadRequestException('Driver is not approved to go online');
    }
    if (availability === DriverAvailability.ONLINE || availability === DriverAvailability.BREAK) {
      const documentsApproved = await this.documentsService.hasAllRequiredApproved(profile.id);
      if (!documentsApproved) {
        throw new BadRequestException(
          "You can't go online yet — your license, insurance, and roadworthiness documents all need to be approved first. Check the Documents section of your profile.",
        );
      }
    }
    const previous = profile.availability;
    profile.availability = availability;
    const saved = await this.driversRepo.save(profile);

    if (previous !== availability) {
      // Close whatever period was open, then start a new one — this is
      // the entire tracking mechanism online-hours/shift/break history
      // is built on. ON_TRIP transitions also get logged here (driven
      // by ride acceptance/completion elsewhere, not this endpoint
      // directly, but still a real availability change worth tracking).
      const open = await this.availabilityLogRepo.findOne({
        where: { driverUserId: userId, endedAt: IsNull() },
        order: { startedAt: 'DESC' },
      });
      if (open) {
        open.endedAt = new Date();
        await this.availabilityLogRepo.save(open);
      }
      await this.availabilityLogRepo.save(
        this.availabilityLogRepo.create({ driverUserId: userId, status: availability }),
      );

      if (availability === DriverAvailability.ONLINE) {
        this.events.emit('driver.online', { driverUserId: userId });
      } else if (availability === DriverAvailability.OFFLINE) {
        this.events.emit('driver.offline', { driverUserId: userId });
      }

      // Generic transition event, additive alongside the two above
      // (which webhooks.service.ts dispatches externally and shouldn't
      // be touched). This is what the live-driver index listens to —
      // it needs every transition, not just online/offline, since
      // ON_TRIP and BREAK also need to pull a driver out of the
      // dispatch-candidate pool.
      this.events.emit('driver.availability.changed', {
        driverUserId: userId,
        driverProfileId: saved.id,
        previous,
        availability,
        vehicleId: saved.activeVehicleId,
        lat: saved.currentLat,
        lng: saved.currentLng,
        locationUpdatedAt: saved.locationUpdatedAt,
      });
    }

    return saved;
  }

  /**
   * Atomically transitions a driver from ONLINE to ON_TRIP, scoped to the
   * given transaction manager. This is the actual driver-level lock: the
   * WHERE clause on `availability = ONLINE` means that if two concurrent
   * bookings (two rides, or a ride and a delivery) both try to claim the
   * same driver, only one UPDATE can match — the other gets `affected: 0`
   * and must fail its booking rather than silently proceeding. Without
   * this, checking `driverProfile.availability === ONLINE` as a plain
   * read before assigning (the previous behavior) leaves a window where
   * both concurrent callers pass the check before either writes.
   *
   * Must be called from inside the *same* transaction that atomically
   * claims the ride/delivery row itself — that's what makes the driver
   * claim and the booking claim succeed or roll back together. A booking
   * claim that fails after this succeeds must roll the whole transaction
   * back, or the driver would be left ON_TRIP with no trip.
   *
   * Deliberately does not emit `driver.availability.changed` — see
   * emitReservedForTrip() below.
   */
  async reserveOnlineDriverForTrip(manager: EntityManager, userId: string): Promise<DriverProfile> {
    const result = await manager
      .createQueryBuilder()
      .update(DriverProfile)
      .set({ availability: DriverAvailability.ON_TRIP })
      .where('userId = :userId', { userId })
      .andWhere('availability = :online', { online: DriverAvailability.ONLINE })
      .execute();

    if (result.affected !== 1) {
      throw new BadRequestException(
        'Driver is no longer available — they may already be on another trip.',
      );
    }

    // Same shift-history bookkeeping setAvailability() does, run through
    // the transaction's manager so it commits/rolls back with everything
    // else rather than as a separate, unprotected write.
    const open = await manager.findOne(DriverAvailabilityLog, {
      where: { driverUserId: userId, endedAt: IsNull() },
      order: { startedAt: 'DESC' },
    });
    if (open) {
      open.endedAt = new Date();
      await manager.save(open);
    }
    await manager.save(
      manager.create(DriverAvailabilityLog, {
        driverUserId: userId,
        status: DriverAvailability.ON_TRIP,
      }),
    );

    return manager.findOneOrFail(DriverProfile, { where: { userId } });
  }

  /**
   * Emits the same `driver.availability.changed` event setAvailability()
   * would have, for a reservation performed via
   * reserveOnlineDriverForTrip(). Call this only after the transaction
   * that called reserveOnlineDriverForTrip() has actually committed —
   * emitting earlier would tell the live-driver index to remove a driver
   * who, if the transaction then rolled back (e.g. the ride was claimed
   * by someone else a moment later), never actually left ONLINE from
   * PostgreSQL's point of view.
   */
  emitReservedForTrip(profile: DriverProfile): void {
    this.events.emit('driver.availability.changed', {
      driverUserId: profile.userId,
      driverProfileId: profile.id,
      previous: DriverAvailability.ONLINE,
      availability: DriverAvailability.ON_TRIP,
      vehicleId: profile.activeVehicleId,
      lat: profile.currentLat,
      lng: profile.currentLng,
      locationUpdatedAt: profile.locationUpdatedAt,
    });
  }

  async setActiveVehicle(userId: string, vehicleId: string): Promise<DriverProfile> {
    const profile = await this.findByUserId(userId);
    profile.activeVehicleId = vehicleId;
    return this.driversRepo.save(profile);
  }

  async assignToFleet(driverUserId: string, fleetCompanyId: string | null): Promise<DriverProfile> {
    const profile = await this.findByUserId(driverUserId);
    profile.fleetCompanyId = fleetCompanyId;
    return this.driversRepo.save(profile);
  }

  async listByFleet(fleetCompanyId: string): Promise<DriverProfile[]> {
    return this.driversRepo.find({ where: { fleetCompanyId } });
  }

  async updateLocation(userId: string, lat: number, lng: number): Promise<DriverProfile> {
    const profile = await this.findByUserId(userId);
    const now = new Date();

    if (profile.currentLat != null && profile.currentLng != null && profile.locationUpdatedAt) {
      await this.fraudService.checkGpsSpoof(
        userId,
        { lat: profile.currentLat, lng: profile.currentLng, at: profile.locationUpdatedAt },
        { lat, lng, at: now },
      );
    }

    profile.currentLat = lat;
    profile.currentLng = lng;
    profile.locationUpdatedAt = now;
    const saved = await this.driversRepo.save(profile);

    // Decoupled the same way notifications/payments are — the tracking
    // module listens for this rather than DriversService knowing anything
    // about websockets or route history. availability/approvalStatus/
    // driverProfileId/vehicleId are additive fields for the live-driver
    // index (see live-driver-index/) — existing consumers (LocationService,
    // GeofenceService) only ever destructured driverUserId/lat/lng/at and
    // are unaffected by the extra fields.
    this.events.emit('driver.location.updated', {
      driverUserId: userId,
      lat,
      lng,
      at: now,
      availability: saved.availability,
      approvalStatus: saved.approvalStatus,
      driverProfileId: saved.id,
      vehicleId: saved.activeVehicleId,
    });

    return saved;
  }

  /**
   * Records the outcome of a completed or cancelled trip and re-evaluates
   * the driver's level against the progression table.
   */
  async recordTripOutcome(
    driverId: string,
    outcome: 'completed' | 'cancelled',
  ): Promise<DriverProfile> {
    const profile = await this.findById(driverId);
    profile.totalTrips += 1;
    if (outcome === 'completed') profile.completedTrips += 1;
    if (outcome === 'cancelled') profile.cancelledTrips += 1;
    profile.level = this.computeLevel(profile.completedTrips, parseFloat(profile.rating));
    return this.driversRepo.save(profile);
  }

  /**
   * Applies a new 1-5 rating to the driver's rolling average and
   * re-evaluates their level (a rating drop can demote a level, matching
   * the "priority dispatch / bonus eligibility tied to level" spec).
   */
  async applyRating(driverProfileId: string, ratingValue: number): Promise<DriverProfile> {
    if (ratingValue < 1 || ratingValue > 5) {
      throw new BadRequestException('Rating must be between 1 and 5');
    }
    const profile = await this.findById(driverProfileId);
    const currentAvg = parseFloat(profile.rating);
    const newCount = profile.ratingCount + 1;
    const newAvg = (currentAvg * profile.ratingCount + ratingValue) / newCount;

    profile.rating = newAvg.toFixed(2);
    profile.ratingCount = newCount;
    profile.level = this.computeLevel(profile.completedTrips, newAvg);
    return this.driversRepo.save(profile);
  }

  /**
   * Finds online, approved drivers with a known location within radiusKm of
   * the given point, sorted nearest-first. Distance is computed in memory
   * (Haversine) since the fleet size here doesn't warrant PostGIS — swap to
   * a geospatial index/query if the online-driver count grows large.
   */
  async findNearby(
    pickup: { lat: number; lng: number },
    options: { city?: string; radiusKm?: number; limit?: number } = {},
  ): Promise<NearbyDriverResult[]> {
    const radiusKm = options.radiusKm ?? 8;
    const limit = options.limit ?? 10;

    const STALE_LOCATION_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes - generous relative to the driver app's 15s reporting interval, tolerates a few missed pings without letting a genuinely offline driver linger indefinitely

    const qb = this.driversRepo
      .createQueryBuilder('driver')
      .where('driver.availability = :availability', { availability: DriverAvailability.ONLINE })
      .andWhere('driver.approvalStatus = :status', { status: DriverApprovalStatus.APPROVED })
      .andWhere('driver.currentLat IS NOT NULL')
      .andWhere('driver.currentLng IS NOT NULL')
      // Real bug this fixes: locationUpdatedAt was already being set
      // correctly on every ping, but nothing ever checked it here - a
      // driver whose app crashed or lost connectivity while still
      // marked online in the database stayed "visible" to passengers
      // indefinitely, with no way for the app to know they'd actually
      // gone unreachable.
      .andWhere('driver.locationUpdatedAt > :staleThreshold', {
        staleThreshold: new Date(Date.now() - STALE_LOCATION_THRESHOLD_MS),
      });

    if (options.city) {
      qb.andWhere('driver.city = :city', { city: options.city });
    }

    const candidates = await qb.getMany();

    return candidates
      .map((profile) => ({
        driverProfileId: profile.id,
        userId: profile.userId,
        distanceKm: this.round(
          haversineDistanceKm(pickup.lat, pickup.lng, profile.currentLat!, profile.currentLng!),
        ),
        level: profile.level,
        rating: parseFloat(profile.rating),
        vehicleId: profile.activeVehicleId,
      }))
      .filter((result) => result.distanceKm <= radiusKm)
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, limit);
  }

  private computeLevel(completedTrips: number, rating: number): DriverLevel {
    let resolved = DriverLevel.ROOKIE;
    for (const tier of LEVEL_PROGRESSION) {
      if (completedTrips >= tier.minTrips && rating >= tier.minRating) {
        resolved = tier.level;
      }
    }
    return resolved;
  }

  private round(value: number): number {
    return Math.round(value * 100) / 100;
  }
}
