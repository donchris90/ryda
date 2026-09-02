import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { OnEvent } from '@nestjs/event-emitter';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { RiskAlert, RiskAlertType, RiskAlertStatus } from './entities/risk-alert.entity';
import { LocationHistory } from '../tracking/entities/location-history.entity';
import { Ride } from '../rides/entities/ride.entity';
import { DriverProfile } from '../drivers/entities/driver-profile.entity';
import { RideStatus } from '../common/enums/ride.enum';
import { haversineDistanceKm } from '../common/utils/geo.util';

/**
 * Batch 5's "Live Safety" requirement: monitor active trips for GPS
 * freshness, excessive speed, unusual stops, route/distance deviation,
 * trip duration anomalies, and unexpected termination - and generate
 * risk alerts for human review, never an automatic accusation.
 *
 * "Do not automatically accuse users of wrongdoing" is enforced in two
 * concrete ways here, not just as a comment: every threshold below is
 * deliberately generous (a normal traffic jam, a legitimate detour, or
 * a genuinely quick trip should never trip these), and every alert's
 * description is written as a neutral, measured fact ("speed reading
 * of 145 km/h" - not "driver is speeding"). This is a signal for a
 * human to look at, not a verdict.
 *
 * Distinct from FraudService.checkGpsSpoof(), which flags physically
 * impossible speed (>250 km/h - GPS spoofing / corrupted data) - the
 * excessive-speed check here sits below that, for real but dangerous
 * driving, a genuinely different concern.
 */
@Injectable()
export class SafetyMonitoringService {
  private readonly logger = new Logger(SafetyMonitoringService.name);

  constructor(
    @InjectRepository(RiskAlert)
    private readonly alertsRepo: Repository<RiskAlert>,
    @InjectRepository(LocationHistory)
    private readonly historyRepo: Repository<LocationHistory>,
    @InjectRepository(Ride)
    private readonly ridesRepo: Repository<Ride>,
    @InjectRepository(DriverProfile)
    private readonly driversRepo: Repository<DriverProfile>,
    private readonly config: ConfigService,
  ) {}

  @OnEvent('driver.location.updated')
  async onDriverLocationUpdated(payload: {
    driverUserId: string;
    lat: number;
    lng: number;
    at: Date;
  }): Promise<void> {
    const activeRide = await this.ridesRepo.findOne({
      where: { driverId: payload.driverUserId, status: RideStatus.IN_PROGRESS },
    });
    if (!activeRide) return; // only monitor once a passenger is actually in the car

    const priorPoint = await this.historyRepo.findOne({
      where: { rideId: activeRide.id },
      order: { recordedAt: 'DESC' },
    });

    await Promise.all([
      this.checkExcessiveSpeed(activeRide, payload, priorPoint),
      this.checkTripDurationAnomaly(activeRide),
      this.checkRouteDeviation(activeRide),
      this.checkUnusualStop(activeRide, payload),
    ]);
  }

  private async checkExcessiveSpeed(
    ride: Ride,
    current: { lat: number; lng: number; at: Date },
    priorPoint: LocationHistory | null,
  ): Promise<void> {
    if (!priorPoint) return;
    const elapsedHours = (current.at.getTime() - priorPoint.recordedAt.getTime()) / 3_600_000;
    if (elapsedHours <= 0) return;

    const distanceKm = haversineDistanceKm(priorPoint.lat, priorPoint.lng, current.lat, current.lng);
    const speedKmh = distanceKm / elapsedHours;
    const threshold = this.config.get<number>('safetyMonitoring.excessiveSpeedKmh')!;
    if (speedKmh <= threshold) return;

    await this.raiseAlert({
      type: RiskAlertType.EXCESSIVE_SPEED,
      ride,
      description: `Speed reading of ${Math.round(speedKmh)} km/h recorded between two GPS points.`,
      details: { speedKmh: Math.round(speedKmh), distanceKm: Math.round(distanceKm * 100) / 100 },
      lat: current.lat,
      lng: current.lng,
    });
  }

  private async checkTripDurationAnomaly(ride: Ride): Promise<void> {
    if (!ride.startedAt || !ride.estimatedDurationMin) return;
    const elapsedMin = (Date.now() - ride.startedAt.getTime()) / 60_000;
    const multiplier = this.config.get<number>('safetyMonitoring.tripDurationAnomalyMultiplier')!;
    if (elapsedMin <= ride.estimatedDurationMin * multiplier) return;

    if (await this.hasOpenAlert(ride.id, RiskAlertType.TRIP_DURATION_ANOMALY)) return;

    await this.raiseAlert({
      type: RiskAlertType.TRIP_DURATION_ANOMALY,
      ride,
      description: `Trip has been in progress for ${Math.round(elapsedMin)} minutes against an estimated ${ride.estimatedDurationMin} minutes.`,
      details: { elapsedMin: Math.round(elapsedMin), estimatedDurationMin: ride.estimatedDurationMin },
    });
  }

  private async checkRouteDeviation(ride: Ride): Promise<void> {
    if (!ride.estimatedDistanceKm) return;
    if (await this.hasOpenAlert(ride.id, RiskAlertType.ROUTE_DEVIATION)) return;

    const points = await this.historyRepo.find({ where: { rideId: ride.id }, order: { recordedAt: 'ASC' } });
    if (points.length < 2) return;

    let traveledKm = 0;
    for (let i = 1; i < points.length; i++) {
      traveledKm += haversineDistanceKm(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng);
    }

    const multiplier = this.config.get<number>('safetyMonitoring.routeDeviationDistanceMultiplier')!;
    if (traveledKm <= ride.estimatedDistanceKm * multiplier) return;

    await this.raiseAlert({
      type: RiskAlertType.ROUTE_DEVIATION,
      ride,
      description: `Distance traveled so far (${traveledKm.toFixed(1)} km) is well beyond the estimated trip distance (${ride.estimatedDistanceKm} km).`,
      details: { traveledKm: Math.round(traveledKm * 100) / 100, estimatedDistanceKm: ride.estimatedDistanceKm },
    });
  }

  private async checkUnusualStop(ride: Ride, current: { lat: number; lng: number; at: Date }): Promise<void> {
    if (await this.hasOpenAlert(ride.id, RiskAlertType.UNUSUAL_STOP)) return;

    const windowMin = this.config.get<number>('safetyMonitoring.unusualStopMinutes')!;
    const since = new Date(current.at.getTime() - windowMin * 60_000);
    const recentPoints = await this.historyRepo.find({
      where: { rideId: ride.id },
      order: { recordedAt: 'ASC' },
    });
    const windowPoints = recentPoints.filter((p) => p.recordedAt >= since);
    if (windowPoints.length < 3) return;
    const oldestInWindow = windowPoints[0];
    if (oldestInWindow.recordedAt.getTime() - since.getTime() > 60_000) return;

    const radiusMeters = this.config.get<number>('safetyMonitoring.unusualStopRadiusMeters')!;
    const allWithinRadius = windowPoints.every(
      (p) => haversineDistanceKm(current.lat, current.lng, p.lat, p.lng) * 1000 <= radiusMeters,
    );
    if (!allWithinRadius) return;

    await this.raiseAlert({
      type: RiskAlertType.UNUSUAL_STOP,
      ride,
      description: `Vehicle appears to have stayed within ${radiusMeters}m for at least ${windowMin} minutes while the trip is in progress.`,
      details: { windowMinutes: windowMin, radiusMeters },
      lat: current.lat,
      lng: current.lng,
    });
  }

  /**
   * GPS freshness can't be caught from a location update, since the
   * problem is the absence of one - runs on a schedule instead,
   * scanning every trip currently in progress.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async checkGpsFreshness(): Promise<void> {
    const activeRides = await this.ridesRepo.find({ where: { status: RideStatus.IN_PROGRESS } });
    if (activeRides.length === 0) return;

    const driverIds = activeRides.map((r) => r.driverId).filter((id): id is string => !!id);
    if (driverIds.length === 0) return;
    const drivers = await this.driversRepo.find({ where: { userId: In(driverIds) } });
    const driverByUserId = new Map(drivers.map((d) => [d.userId, d]));

    const staleSeconds = this.config.get<number>('safetyMonitoring.gpsStaleSeconds')!;
    const staleCutoff = new Date(Date.now() - staleSeconds * 1000);

    for (const ride of activeRides) {
      if (!ride.driverId) continue;
      const driver = driverByUserId.get(ride.driverId);
      if (!driver) continue;

      const isStale = !driver.locationUpdatedAt || driver.locationUpdatedAt < staleCutoff;
      if (!isStale) continue;
      if (await this.hasOpenAlert(ride.id, RiskAlertType.GPS_STALE)) continue;

      const ageSeconds = driver.locationUpdatedAt
        ? Math.round((Date.now() - driver.locationUpdatedAt.getTime()) / 1000)
        : null;
      await this.raiseAlert({
        type: RiskAlertType.GPS_STALE,
        ride,
        description: ageSeconds != null
          ? `No GPS update received for this driver in ${ageSeconds} seconds while a trip is in progress.`
          : 'No GPS reading has been received for this driver at all while a trip is in progress.',
        details: { ageSeconds },
      });
    }
  }

  /**
   * A ride completing implausibly fast after starting is worth a
   * glance - could be a genuinely short trip, a driver mistakenly
   * tapping complete, or something worth a closer look. Not evidence
   * of anything on its own.
   */
  @OnEvent('ride.status_changed')
  async onRideStatusChanged(payload: { rideId: string; status: RideStatus }): Promise<void> {
    if (payload.status !== RideStatus.COMPLETED) return;

    const ride = await this.ridesRepo.findOne({ where: { id: payload.rideId } });
    if (!ride || !ride.startedAt || !ride.completedAt) return;

    const durationSeconds = (ride.completedAt.getTime() - ride.startedAt.getTime()) / 1000;
    const minPlausible = this.config.get<number>('safetyMonitoring.minPlausibleTripSeconds')!;
    if (durationSeconds >= minPlausible) return;

    await this.raiseAlert({
      type: RiskAlertType.UNEXPECTED_TERMINATION,
      ride,
      description: `Trip was marked completed ${Math.round(durationSeconds)} seconds after starting.`,
      details: { durationSeconds: Math.round(durationSeconds) },
    });
  }

  private async hasOpenAlert(rideId: string, type: RiskAlertType): Promise<boolean> {
    const existing = await this.alertsRepo.findOne({
      where: { rideId, type, status: RiskAlertStatus.OPEN },
    });
    return !!existing;
  }

  private async raiseAlert(entry: {
    type: RiskAlertType;
    ride: Ride;
    description: string;
    details?: Record<string, unknown>;
    lat?: number;
    lng?: number;
  }): Promise<RiskAlert> {
    const saved = await this.alertsRepo.save(
      this.alertsRepo.create({
        type: entry.type,
        rideId: entry.ride.id,
        driverUserId: entry.ride.driverId,
        description: entry.description,
        details: entry.details ?? null,
        lat: entry.lat ?? null,
        lng: entry.lng ?? null,
      }),
    );
    this.logger.warn(`Risk alert raised: type=${entry.type} rideId=${entry.ride.id} - ${entry.description}`);
    return saved;
  }

  async listOpenAlerts(): Promise<RiskAlert[]> {
    return this.alertsRepo.find({ where: { status: RiskAlertStatus.OPEN }, order: { createdAt: 'DESC' } });
  }

  async listForRide(rideId: string): Promise<RiskAlert[]> {
    return this.alertsRepo.find({ where: { rideId }, order: { createdAt: 'ASC' } });
  }

  async review(
    alertId: string,
    adminUserId: string,
    status: RiskAlertStatus.REVIEWED | RiskAlertStatus.DISMISSED,
    notes?: string,
  ): Promise<RiskAlert> {
    const alert = await this.alertsRepo.findOne({ where: { id: alertId } });
    if (!alert) throw new NotFoundException('Risk alert not found');
    alert.status = status;
    alert.reviewedBy = adminUserId;
    alert.reviewNotes = notes ?? null;
    alert.reviewedAt = new Date();
    return this.alertsRepo.save(alert);
  }
}
