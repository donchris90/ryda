import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LiveDriverIndexService } from '../live-driver-index/live-driver-index.service';
import { DriverProfile } from '../drivers/entities/driver-profile.entity';
import { DriverServiceCapability } from '../drivers/entities/driver-service-capability.entity';
import { Vehicle } from '../vehicles/entities/vehicle.entity';
import { DriverApprovalStatus } from '../common/enums/driver-status.enum';
import { VehicleStatus } from '../common/enums/vehicle.enum';
import { DriverService, ServiceApprovalStatus, isOnlineForService } from '../common/enums/driver-service.enum';
import { DeliveryVehicleType } from '../logistics/entities/delivery-order.entity';
import { canVehicleCoverDelivery } from '../common/vehicle-capacity-match.util';
import { haversineDistanceKm } from '../common/utils/geo.util';

export interface CourierMatchDiagnosticResult {
  driverUserId: string;
  redisIndexed: boolean;
  gpsFresh: boolean;
  gpsAgeSeconds: number | null;
  distanceKm: number | null;
  approvalStatus: string | null;
  availability: string | null;
  // Whether DriverServiceCapability has an APPROVED row for DELIVERY —
  // distinct from `availability` above, which only says what the
  // driver is *currently accepting*, not what they're authorized for.
  deliveryServiceApproved: boolean;
  hasActiveVehicle: boolean;
  vehicleStatus: string | null;
  vehicleCompatible: boolean | null;
  finalEligible: boolean;
  rejectionReason: string | null;
}

/**
 * Backs the admin-only "Why is driver X not available for courier
 * matching at pickup Y?" endpoint (requirement: PRODUCTION DIAGNOSTIC
 * ENDPOINT). Deliberately re-implements the same pipeline order
 * CandidateSearchService.applyEligibility() uses (Redis -> GPS
 * freshness -> approval -> availability -> service approval -> active
 * vehicle -> vehicle status -> compatibility) rather than calling
 * searchNearby() itself, because searchNearby() silently drops a
 * driver who fails any of those checks — exactly the information this
 * diagnostic exists to surface instead of hide. Reports only safe
 * fields: no name, phone, documents, or raw Redis internals beyond
 * indexed/fresh booleans.
 */
@Injectable()
export class CourierMatchDiagnosticService {
  constructor(
    private readonly liveDriverIndex: LiveDriverIndexService,
    @InjectRepository(DriverProfile)
    private readonly driversRepo: Repository<DriverProfile>,
    @InjectRepository(Vehicle)
    private readonly vehiclesRepo: Repository<Vehicle>,
    @InjectRepository(DriverServiceCapability)
    private readonly capabilitiesRepo: Repository<DriverServiceCapability>,
  ) {}

  async diagnose(
    driverUserId: string,
    pickup: { lat: number; lng: number },
    deliveryVehicleType: DeliveryVehicleType,
  ): Promise<CourierMatchDiagnosticResult> {
    const entry = await this.liveDriverIndex.getEntry(driverUserId);
    const profile = await this.driversRepo.findOne({
      where: { userId: driverUserId },
    });
    const vehicle = profile?.activeVehicleId
      ? await this.vehiclesRepo.findOne({
          where: { id: profile.activeVehicleId },
        })
      : null;
    const deliveryCapability = profile
      ? await this.capabilitiesRepo.findOne({
          where: { driverProfileId: profile.id, service: DriverService.DELIVERY },
        })
      : null;

    const distanceKm =
      entry.lat != null && entry.lng != null
        ? haversineDistanceKm(pickup.lat, pickup.lng, entry.lat, entry.lng)
        : null;

    const isApproved =
      profile?.approvalStatus === DriverApprovalStatus.APPROVED;
    const isOnlineForDelivery = !!profile && isOnlineForService(profile.availability, DriverService.DELIVERY);
    const isDeliveryServiceApproved = deliveryCapability?.status === ServiceApprovalStatus.APPROVED;
    const hasActiveVehicle = !!profile?.activeVehicleId;
    const vehicleActive = vehicle?.status === VehicleStatus.ACTIVE;
    const vehicleCompatible = vehicle
      ? canVehicleCoverDelivery(vehicle.category, deliveryVehicleType)
      : null;

    const finalEligible =
      entry.indexed &&
      entry.isFresh &&
      isApproved &&
      isOnlineForDelivery &&
      isDeliveryServiceApproved &&
      hasActiveVehicle &&
      vehicleActive &&
      !!vehicleCompatible;

    // First failing check in the same order the real pipeline checks
    // them — matches the SAFE_REJECTION_REASON codes from requirement
    // NINTH so admins reading both logs and this endpoint see
    // consistent vocabulary.
    let rejectionReason: string | null = null;
    if (!entry.indexed) rejectionReason = 'NOT_IN_REDIS';
    else if (!entry.isFresh) rejectionReason = 'GPS_STALE';
    else if (!isApproved) rejectionReason = 'NOT_APPROVED';
    else if (!isOnlineForDelivery) rejectionReason = 'NOT_ONLINE_FOR_DELIVERY';
    else if (!isDeliveryServiceApproved) rejectionReason = 'DELIVERY_SERVICE_NOT_APPROVED';
    else if (!hasActiveVehicle) rejectionReason = 'NO_ACTIVE_VEHICLE';
    else if (!vehicleActive) rejectionReason = 'VEHICLE_INACTIVE';
    else if (!vehicleCompatible) rejectionReason = 'INCOMPATIBLE_VEHICLE';

    return {
      driverUserId,
      redisIndexed: entry.indexed,
      gpsFresh: entry.isFresh,
      gpsAgeSeconds:
        entry.gpsFreshMs != null ? Math.round(entry.gpsFreshMs / 1000) : null,
      distanceKm:
        distanceKm != null ? Math.round(distanceKm * 100) / 100 : null,
      approvalStatus: profile?.approvalStatus ?? null,
      availability: profile?.availability ?? null,
      deliveryServiceApproved: !!isDeliveryServiceApproved,
      hasActiveVehicle,
      vehicleStatus: vehicle?.status ?? null,
      vehicleCompatible,
      finalEligible,
      rejectionReason,
    };
  }
}
