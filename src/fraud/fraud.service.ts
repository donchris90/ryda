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
  /**
   * Records this device against the user, flags MULTIPLE_ACCOUNTS_SAME_DEVICE
   * when the fingerprint is shared with a different account, and flags
   * NEW_DEVICE_LOGIN (informational, not itself acted on) the first
   * time THIS user is ever seen on THIS device - the two are
   * independent signals: a device can be new to this user without
   * being shared with anyone else, and vice versa (a long-registered
   * shared device). Returns whether it was new, so a caller with
   * access to the user's contact info (AuthService.login()) can
   * decide whether to actually notify them - FraudService itself
   * doesn't send notifications.
   */
  async recordDeviceFingerprint(
    userId: string,
    fingerprint: string,
    ipAddress?: string,
  ): Promise<{ isNewDevice: boolean }> {
    if (!fingerprint) return { isNewDevice: false };

    const [device, existingDeviceCount] = await Promise.all([
      this.devicesRepo.findOne({ where: { userId, fingerprint } }),
      this.devicesRepo.count({ where: { userId } }),
    ]);
    // A brand-new account's very first login is never "a new device" in
    // the suspicious sense - there's nothing established yet to be new
    // relative to. Only a device fingerprint this user hasn't used
    // before, on an account that already has at least one other device
    // on file, is the actual signal worth surfacing.
    const isNewDevice = !device && existingDeviceCount > 0;
    let record = device;
    if (!record) {
      record = this.devicesRepo.create({ userId, fingerprint, ipAddress });
    } else {
      record.ipAddress = ipAddress ?? record.ipAddress;
    }
    await this.devicesRepo.save(record);

    if (isNewDevice) {
      await this.raiseFlag({
        type: FraudFlagType.NEW_DEVICE_LOGIN,
        userId,
        severity: FraudFlagSeverity.LOW,
        details: { fingerprint, ipAddress },
      });
    }

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

    return { isNewDevice };
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

  /**
   * Domain-agnostic by design: PaymentsService already has the
   * PaymentRecord repo and knows what "recent" means for a card
   * charge, so it counts its own failures and hands this the number -
   * FraudService doesn't need to know PaymentRecord's schema to raise
   * a flag about a pattern in it. A count below the threshold is a
   * silent no-op (most users who fail a payment once just retry
   * normally); this is specifically about several failures clustering
   * together, the classic card-testing signature.
   */
  async checkPaymentFailurePattern(userId: string, recentFailureCount: number): Promise<void> {
    if (recentFailureCount < 3) return;

    await this.raiseFlag({
      type: FraudFlagType.REPEATED_PAYMENT_FAILURES,
      userId,
      severity: recentFailureCount >= 5 ? FraudFlagSeverity.HIGH : FraudFlagSeverity.MEDIUM,
      details: { recentFailureCount },
    });
  }

  /**
   * Same domain-agnostic shape as checkPaymentFailurePattern() above -
   * PaymentsService counts distinct cards added in its own recent
   * window and hands this the number. Several cards added quickly is
   * itself the signal (stolen-card-list testing), independent of
   * whether any of them were ever actually charged.
   */
  async checkMultipleCardsAdded(userId: string, recentCardCount: number): Promise<void> {
    if (recentCardCount < 3) return;

    await this.raiseFlag({
      type: FraudFlagType.MULTIPLE_CARDS_ADDED,
      userId,
      severity: recentCardCount >= 5 ? FraudFlagSeverity.HIGH : FraudFlagSeverity.MEDIUM,
      details: { recentCardCount },
    });
  }

  /**
   * Same domain-agnostic shape as the payment checks above -
   * PromotionsService counts this user's own recent redemptions and
   * hands this the number. Redeeming a handful of promos over time is
   * completely ordinary; several in a short window is the pattern
   * worth a human's attention (code-stacking, or one of several
   * accounts cycling through referral/first-ride offers).
   */
  async checkPromoRedemptionPattern(userId: string, recentRedemptionCount: number): Promise<void> {
    if (recentRedemptionCount < 4) return;

    await this.raiseFlag({
      type: FraudFlagType.REPEATED_PROMO_REDEMPTION,
      userId,
      severity: recentRedemptionCount >= 8 ? FraudFlagSeverity.HIGH : FraudFlagSeverity.MEDIUM,
      details: { recentRedemptionCount },
    });
  }

  /**
   * Ordinary passengers cancel occasionally - a driver running late,
   * a change of plan. The pattern worth flagging is several
   * cancellations clustering together, which can mean pickup-address
   * abuse (tying up drivers with no intent to ride) or a passenger
   * repeatedly cancelling right as a fare would apply.
   */
  async checkRepeatedCancellations(userId: string, recentCancellationCount: number): Promise<void> {
    if (recentCancellationCount < 4) return;

    await this.raiseFlag({
      type: FraudFlagType.REPEATED_CANCELLATIONS,
      userId,
      severity: recentCancellationCount >= 8 ? FraudFlagSeverity.HIGH : FraudFlagSeverity.MEDIUM,
      details: { recentCancellationCount },
    });
  }

  /**
   * Refunds are a normal, healthy part of a marketplace - most users
   * who ever get one get exactly one. Several refunds for the same
   * user in a short window is what's worth a look: repeat complaints
   * that may not be genuine, or a pattern of gaming the refund flow
   * itself.
   */
  async checkExcessiveRefunds(userId: string, recentRefundCount: number): Promise<void> {
    if (recentRefundCount < 3) return;

    await this.raiseFlag({
      type: FraudFlagType.EXCESSIVE_REFUNDS,
      userId,
      severity: recentRefundCount >= 6 ? FraudFlagSeverity.HIGH : FraudFlagSeverity.MEDIUM,
      details: { recentRefundCount },
    });
  }

  /**
   * Distinct from the daily-value cap WalletTransfersService already
   * enforces as a hard limit (SETTING_KEYS.WALLET_TRANSFER_MAX_DAILY) -
   * this is about velocity/count, not total amount. A user sending
   * many small transfers in quick succession under that value cap is
   * a different signal than one big transfer, and one this fraud
   * check exists specifically to catch (mule-account cash-out
   * patterns often stay under a per-transaction or daily amount
   * limit on purpose).
   */
  async checkWalletVelocity(userId: string, recentTransferCount: number): Promise<void> {
    if (recentTransferCount < 5) return;

    await this.raiseFlag({
      type: FraudFlagType.UNUSUAL_WALLET_VELOCITY,
      userId,
      severity: recentTransferCount >= 10 ? FraudFlagSeverity.HIGH : FraudFlagSeverity.MEDIUM,
      details: { recentTransferCount },
    });
  }

  /**
   * Deliberately a lower bar than the other checks in this file: a
   * chargeback isn't a free attempt the way a failed card charge or
   * a cancelled ride is - it's a completed dispute where real money
   * already moved and the platform carries card-network penalty
   * risk. One resolved chargeback still only reaches MEDIUM, though
   * (never skips straight past a human review) - "lower bar" means
   * flagging starts at 1, not that a single chargeback alone should
   * ever be enough to act on unilaterally.
   */
  async checkChargebackHistory(userId: string, resolvedChargebackCount: number): Promise<void> {
    if (resolvedChargebackCount < 1) return;

    await this.raiseFlag({
      type: FraudFlagType.CHARGEBACK_HISTORY,
      userId,
      severity: resolvedChargebackCount >= 2 ? FraudFlagSeverity.HIGH : FraudFlagSeverity.MEDIUM,
      details: { resolvedChargebackCount },
    });
  }

  /**
   * Public entry point for a flag raised by domain logic outside this
   * module (e.g. WithdrawalsService blocking or flagging a request
   * based on the risk engine's band) - the internal checks in this
   * file (checkGpsSpoof, recordDeviceFingerprint, checkReferralAbuse)
   * use it the same way. Kept as one shared implementation so every
   * flag, regardless of source, has the same shape or the fraud
   * center to render.
   */
  async raiseFlag(entry: {
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

  /** The Fraud page's own top metric cards - counts across ALL flags, not scoped to any one user. */
  async getSummary() {
    const [totalFlags, openCount, escalatedCount, highSeverityOpenCount] = await Promise.all([
      this.flagsRepo.count(),
      this.flagsRepo.count({ where: { status: FraudFlagStatus.OPEN } }),
      this.flagsRepo.count({ where: { status: FraudFlagStatus.ESCALATED } }),
      this.flagsRepo.count({
        where: [
          { status: FraudFlagStatus.OPEN, severity: FraudFlagSeverity.HIGH },
          { status: FraudFlagStatus.OPEN, severity: FraudFlagSeverity.CRITICAL },
        ],
      }),
    ]);
    return { totalFlags, openCount, escalatedCount, highSeverityOpenCount };
  }

  /** Every device this user has ever logged in from - the "devices" section of their fraud-center profile. */
  async listDevicesForUser(userId: string): Promise<UserDevice[]> {
    return this.devicesRepo.find({ where: { userId }, order: { lastSeenAt: 'DESC' } });
  }

  /**
   * Accounts connected to this one via either signal this module
   * already tracks: sharing a device fingerprint, or named as the
   * `relatedUserId` on one of this user's own flags (e.g. the other
   * side of a REFERRAL_ABUSE pair). Two different kinds of
   * "related", surfaced together since an admin reviewing one
   * account genuinely wants to know about both.
   */
  async findRelatedAccounts(userId: string): Promise<string[]> {
    const [devices, flags] = await Promise.all([
      this.devicesRepo.find({ where: { userId } }),
      this.flagsRepo.find({ where: { userId } }),
    ]);

    const fingerprints = devices.map((d) => d.fingerprint);
    const sharedDeviceUsers = fingerprints.length
      ? await this.devicesRepo.find({ where: fingerprints.map((fingerprint) => ({ fingerprint })) })
      : [];

    const related = new Set<string>();
    for (const d of sharedDeviceUsers) {
      if (d.userId !== userId) related.add(d.userId);
    }
    for (const f of flags) {
      if (f.relatedUserId && f.relatedUserId !== userId) related.add(f.relatedUserId);
    }

    return [...related];
  }
}
