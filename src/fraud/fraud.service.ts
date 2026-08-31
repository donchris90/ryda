import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserDevice } from './entities/user-device.entity';
import {
  FraudFlag,
  FraudFlagSeverity,
  FraudFlagStatus,
  FraudFlagType,
} from './entities/fraud-flag.entity';
import { haversineDistanceKm } from '../common/utils/geo.util';

export interface FraudFlagFilters {
  type?: FraudFlagType;
  status?: FraudFlagStatus;
  userId?: string;
  page?: number;
  pageSize?: number;
}

// A driver moving faster than this between two location updates is almost
// certainly GPS-spoofed, not actually driving. Commercial flights cruise
// around 900 km/h, so this is deliberately generous to avoid false
// positives from a stale/delayed location ping.
const IMPOSSIBLE_SPEED_KMH = 250;

@Injectable()
export class FraudService {
  constructor(
    @InjectRepository(UserDevice)
    private readonly devicesRepo: Repository<UserDevice>,
    @InjectRepository(FraudFlag)
    private readonly flagsRepo: Repository<FraudFlag>,
  ) {}

  /**
   * Records a device fingerprint seen for this user (call on register/
   * login), and flags a duplicate-account signal if the same fingerprint is
   * already associated with a *different* user.
   */
  async recordDeviceFingerprint(
    userId: string,
    fingerprint: string,
    ipAddress?: string,
  ): Promise<void> {
    if (!fingerprint) return;

    let device = await this.devicesRepo.findOne({ where: { userId, fingerprint } });
    if (!device) {
      device = this.devicesRepo.create({ userId, fingerprint, ipAddress });
    } else {
      device.ipAddress = ipAddress ?? device.ipAddress;
    }
    await this.devicesRepo.save(device);

    const others = await this.devicesRepo.find({ where: { fingerprint } });
    const otherUserIds = [...new Set(others.map((d) => d.userId))].filter((id) => id !== userId);

    if (otherUserIds.length > 0) {
      await this.raiseFlag({
        type: FraudFlagType.MULTIPLE_ACCOUNTS_SAME_DEVICE,
        userId,
        relatedUserId: otherUserIds[0],
        severity: otherUserIds.length > 2 ? FraudFlagSeverity.HIGH : FraudFlagSeverity.MEDIUM,
        details: { fingerprint, otherUserIds },
      });
    }
  }

  /**
   * Flags GPS spoofing when a driver's implied speed between two location
   * updates is physically impossible. Called from DriversService before
   * accepting a new location update.
   */
  async checkGpsSpoof(
    userId: string,
    previous: { lat: number; lng: number; at: Date } | null,
    next: { lat: number; lng: number; at: Date },
  ): Promise<void> {
    if (!previous) return;

    const elapsedHours = (next.at.getTime() - previous.at.getTime()) / 3_600_000;
    if (elapsedHours <= 0) return;

    const distanceKm = haversineDistanceKm(previous.lat, previous.lng, next.lat, next.lng);
    const impliedSpeedKmh = distanceKm / elapsedHours;

    if (impliedSpeedKmh > IMPOSSIBLE_SPEED_KMH) {
      await this.raiseFlag({
        type: FraudFlagType.GPS_SPOOF,
        userId,
        severity: FraudFlagSeverity.HIGH,
        details: {
          impliedSpeedKmh: Math.round(impliedSpeedKmh),
          distanceKm: Math.round(distanceKm * 100) / 100,
          elapsedSeconds: Math.round(elapsedHours * 3600),
          previous,
          next,
        },
      });
    }
  }

  /** Flags referral abuse when the referrer and referee share a device fingerprint. */
  async checkReferralAbuse(referrerUserId: string, refereeUserId: string): Promise<void> {
    const [referrerDevices, refereeDevices] = await Promise.all([
      this.devicesRepo.find({ where: { userId: referrerUserId } }),
      this.devicesRepo.find({ where: { userId: refereeUserId } }),
    ]);

    const referrerFingerprints = new Set(referrerDevices.map((d) => d.fingerprint));
    const sharedFingerprint = refereeDevices.find((d) => referrerFingerprints.has(d.fingerprint));

    if (sharedFingerprint) {
      await this.raiseFlag({
        type: FraudFlagType.REFERRAL_ABUSE,
        userId: refereeUserId,
        relatedUserId: referrerUserId,
        severity: FraudFlagSeverity.HIGH,
        details: { sharedFingerprint: sharedFingerprint.fingerprint },
      });
    }
  }

  private async raiseFlag(entry: {
    type: FraudFlagType;
    userId: string;
    relatedUserId?: string | null;
    severity: FraudFlagSeverity;
    details?: Record<string, unknown>;
  }): Promise<FraudFlag> {
    return this.flagsRepo.save(
      this.flagsRepo.create({
        type: entry.type,
        userId: entry.userId,
        relatedUserId: entry.relatedUserId ?? null,
        severity: entry.severity,
        details: entry.details ?? null,
      }),
    );
  }

  /**
   * Aggregate counts for the admin fraud dashboard. Kept as simple grouped
   * counts rather than a computed "risk score" — nothing upstream of this
   * module currently produces a scored/weighted risk value per user, so a
   * fabricated score here would just be decoration, not signal.
   */
  async getSummary(): Promise<{
    totalFlags: number;
    openCount: number;
    escalatedCount: number;
    reviewedCount: number;
    dismissedCount: number;
    highSeverityOpenCount: number;
    byType: Record<string, number>;
    recent: FraudFlag[];
  }> {
    const [
      totalFlags,
      openCount,
      escalatedCount,
      reviewedCount,
      dismissedCount,
      highSeverityOpenCount,
      byTypeRows,
      recent,
    ] = await Promise.all([
      this.flagsRepo.count(),
      this.flagsRepo.count({ where: { status: FraudFlagStatus.OPEN } }),
      this.flagsRepo.count({ where: { status: FraudFlagStatus.ESCALATED } }),
      this.flagsRepo.count({ where: { status: FraudFlagStatus.REVIEWED } }),
      this.flagsRepo.count({ where: { status: FraudFlagStatus.DISMISSED } }),
      this.flagsRepo.count({
        where: { status: FraudFlagStatus.OPEN, severity: FraudFlagSeverity.HIGH },
      }),
      this.flagsRepo
        .createQueryBuilder('flag')
        .select('flag.type', 'type')
        .addSelect('COUNT(*)', 'count')
        .groupBy('flag.type')
        .getRawMany<{ type: string; count: string }>(),
      this.flagsRepo.find({ order: { createdAt: 'DESC' }, take: 10 }),
    ]);

    const byType: Record<string, number> = {};
    for (const row of byTypeRows) byType[row.type] = parseInt(row.count, 10);

    return {
      totalFlags,
      openCount,
      escalatedCount,
      reviewedCount,
      dismissedCount,
      highSeverityOpenCount,
      byType,
      recent,
    };
  }

  async listFlags(filters: FraudFlagFilters): Promise<{ data: FraudFlag[]; total: number; page: number; pageSize: number }> {
    const page = filters.page ?? 1;
    const pageSize = Math.min(filters.pageSize ?? 50, 200);

    const qb = this.flagsRepo.createQueryBuilder('flag').orderBy('flag.createdAt', 'DESC');
    if (filters.type) qb.andWhere('flag.type = :type', { type: filters.type });
    if (filters.status) qb.andWhere('flag.status = :status', { status: filters.status });
    if (filters.userId) qb.andWhere('flag.userId = :userId', { userId: filters.userId });
    qb.skip((page - 1) * pageSize).take(pageSize);

    const [data, total] = await qb.getManyAndCount();
    return { data, total, page, pageSize };
  }

  async reviewFlag(
    id: string,
    reviewerUserId: string,
    status: FraudFlagStatus,
    notes?: string,
  ): Promise<FraudFlag> {
    const flag = await this.flagsRepo.findOne({ where: { id } });
    if (!flag) throw new NotFoundException('Flag not found');
    flag.status = status;
    flag.reviewedBy = reviewerUserId;
    flag.reviewNotes = notes ?? null;
    return this.flagsRepo.save(flag);
  }
}
