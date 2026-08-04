import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, IsNull } from 'typeorm';
import { DriverAvailabilityLog } from './entities/driver-availability-log.entity';
import { DriverAvailability } from '../common/enums/driver-status.enum';
import { DriverProfile } from './entities/driver-profile.entity';
import { Ride } from '../rides/entities/ride.entity';
import { RideStatus, CancelledBy } from '../common/enums/ride.enum';
import { RideOffer, RideOfferStatus } from '../dispatch/entities/ride-offer.entity';

@Injectable()
export class DriverAnalyticsService {
  constructor(
    @InjectRepository(DriverAvailabilityLog)
    private readonly logsRepo: Repository<DriverAvailabilityLog>,
    @InjectRepository(DriverProfile)
    private readonly driversRepo: Repository<DriverProfile>,
    @InjectRepository(Ride)
    private readonly ridesRepo: Repository<Ride>,
    @InjectRepository(RideOffer)
    private readonly offersRepo: Repository<RideOffer>,
  ) {}

  /**
   * The current in-progress shift, if the driver has gone online at all
   * since their last full-offline period. Not a separately-started
   * concept — derived from the availability log the same way shift
   * history below is, just bounded by "now" instead of a later offline
   * transition.
   */
  async getCurrentShift(driverUserId: string) {
    const recentLogs = await this.logsRepo.find({
      where: { driverUserId },
      order: { startedAt: 'DESC' },
      take: 200, // generous bound — a single shift won't realistically have more status changes than this
    });

    if (recentLogs.length === 0 || recentLogs[0].status === DriverAvailability.OFFLINE) {
      return { isOnShift: false, startedAt: null, onlineMinutes: 0, breakMinutes: 0, currentStatus: DriverAvailability.OFFLINE };
    }

    // Walk backwards from the most recent entry until hitting an OFFLINE
    // row (the shift boundary) or running out of history.
    const shiftLogs: DriverAvailabilityLog[] = [];
    for (const log of recentLogs) {
      if (log.status === DriverAvailability.OFFLINE) break;
      shiftLogs.push(log);
    }
    shiftLogs.reverse(); // chronological order

    const now = Date.now();
    let onlineMs = 0;
    let breakMs = 0;
    for (const log of shiftLogs) {
      const end = log.endedAt ? log.endedAt.getTime() : now;
      const duration = end - log.startedAt.getTime();
      if (log.status === DriverAvailability.BREAK) breakMs += duration;
      else onlineMs += duration; // ONLINE and ON_TRIP both count as "working" time within the shift
    }

    return {
      isOnShift: true,
      startedAt: shiftLogs[0].startedAt,
      onlineMinutes: Math.round(onlineMs / 60000),
      breakMinutes: Math.round(breakMs / 60000),
      currentStatus: recentLogs[0].status,
    };
  }

  /**
   * Past shifts, each bounded by OFFLINE periods — grouped in
   * application code rather than SQL, since a driver's shift count is
   * naturally small and the grouping logic (walk-and-bucket on a status
   * change) is much clearer this way than as a window-function query.
   */
  async getShiftHistory(driverUserId: string, limit = 20) {
    const logs = await this.logsRepo.find({
      where: { driverUserId },
      order: { startedAt: 'ASC' },
    });

    const shifts: { startedAt: Date; endedAt: Date | null; onlineMinutes: number; breakMinutes: number }[] = [];
    let current: { startedAt: Date; endedAt: Date | null; onlineMinutes: number; breakMinutes: number } | null = null;

    for (const log of logs) {
      const end = log.endedAt ?? new Date();
      const durationMs = end.getTime() - log.startedAt.getTime();

      if (log.status === DriverAvailability.OFFLINE) {
        if (current) {
          current.endedAt = log.startedAt; // shift ends when OFFLINE begins
          shifts.push(current);
          current = null;
        }
        continue;
      }

      if (!current) current = { startedAt: log.startedAt, endedAt: null, onlineMinutes: 0, breakMinutes: 0 };
      if (log.status === DriverAvailability.BREAK) current.breakMinutes += Math.round(durationMs / 60000);
      else current.onlineMinutes += Math.round(durationMs / 60000);
    }
    if (current) shifts.push(current); // still ongoing

    return shifts.reverse().slice(0, limit);
  }

  /**
   * Acceptance rate and cancellation rate needed zero new tracking —
   * RideOffer.status and Ride.cancelledBy already existed and are
   * already populated by the real accept/decline/cancel flows. Online
   * hours is the one figure that needed the new log table above.
   */
  async getSummary(driverUserId: string, from?: Date, to?: Date) {
    // Fetched unfiltered and filtered in memory below (same pragmatic
    // choice as shift grouping) — a single driver's ride/offer/log
    // history is naturally bounded, and the date-range filter needs to
    // apply to different date fields per record type (completedAt for
    // rides, offeredAt for offers, startedAt for logs), which is
    // simpler to express once as a shared predicate than as three
    // separate SQL WHERE clauses.
    const rides = await this.ridesRepo.find({ where: { driverId: driverUserId } });
    const inRange = (d: Date | null) => {
      if (!d) return !from && !to;
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    };
    const relevantRides = rides.filter((r) => inRange(r.completedAt ?? r.createdAt));

    const completedRides = relevantRides.filter((r) => r.status === RideStatus.COMPLETED);
    const driverCancelledRides = relevantRides.filter(
      (r) => r.status === RideStatus.CANCELLED && r.cancelledBy === CancelledBy.DRIVER,
    );
    const totalConcluded = relevantRides.filter((r) =>
      [RideStatus.COMPLETED, RideStatus.CANCELLED].includes(r.status),
    );

    const offers = await this.offersRepo.find({ where: { driverUserId } });
    const relevantOffers = offers.filter((o) => inRange(o.offeredAt));
    const decidedOffers = relevantOffers.filter((o) =>
      [RideOfferStatus.ACCEPTED, RideOfferStatus.DECLINED, RideOfferStatus.EXPIRED].includes(o.status),
    );
    const acceptedOffers = relevantOffers.filter((o) => o.status === RideOfferStatus.ACCEPTED);

    const logs = await this.logsRepo.find({ where: { driverUserId, status: DriverAvailability.ONLINE } });
    const relevantLogs = logs.filter((l) => inRange(l.startedAt));
    const onlineMs = relevantLogs.reduce((sum, l) => {
      const end = l.endedAt ?? new Date();
      return sum + (end.getTime() - l.startedAt.getTime());
    }, 0);

    const profile = await this.driversRepo.findOne({ where: { userId: driverUserId } });

    return {
      completedRides: completedRides.length,
      driverCancelledRides: driverCancelledRides.length,
      cancellationRate: totalConcluded.length > 0 ? parseFloat(((driverCancelledRides.length / totalConcluded.length) * 100).toFixed(1)) : 0,
      acceptanceRate: decidedOffers.length > 0 ? parseFloat(((acceptedOffers.length / decidedOffers.length) * 100).toFixed(1)) : 0,
      onlineHours: parseFloat((onlineMs / 3600000).toFixed(1)),
      rating: profile?.rating ?? null,
      ratingCount: profile?.ratingCount ?? 0,
    };
  }
}
