import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Ride } from '../rides/entities/ride.entity';
import { User } from '../users/entities/user.entity';
import { DriverProfile } from '../drivers/entities/driver-profile.entity';
import { UserRole } from '../common/enums/user-role.enum';
import { RideStatus } from '../common/enums/ride.enum';
import { DriverAvailability } from '../common/enums/driver-status.enum';

export interface DashboardOverview {
  totalUsers: number;
  totalPassengers: number;
  totalDrivers: number;
  driversOnline: number;
  totalRides: number;
  completedRides: number;
  cancelledRides: number;
  totalGmv: string; // gross merchandise value — sum of totalFare across completed rides
  totalPlatformRevenue: string; // sum of commissionAmount across completed rides
}

export interface RevenuePoint {
  period: string;
  rideCount: number;
  gmv: string;
  platformRevenue: string;
}

@Injectable()
export class AnalyticsService {
  constructor(
    @InjectRepository(Ride) private readonly ridesRepo: Repository<Ride>,
    @InjectRepository(User) private readonly usersRepo: Repository<User>,
    @InjectRepository(DriverProfile) private readonly driversRepo: Repository<DriverProfile>,
  ) {}

  async getOverview(): Promise<DashboardOverview> {
    const [totalUsers, totalPassengers, totalDrivers, driversOnline] = await Promise.all([
      this.usersRepo.count(),
      this.usersRepo.count({ where: { role: UserRole.PASSENGER } }),
      this.usersRepo.count({ where: { role: UserRole.DRIVER } }),
      this.driversRepo.count({ where: { availability: DriverAvailability.ONLINE } }),
    ]);

    const [totalRides, completedRides, cancelledRides] = await Promise.all([
      this.ridesRepo.count(),
      this.ridesRepo.count({ where: { status: RideStatus.COMPLETED } }),
      this.ridesRepo.count({ where: { status: RideStatus.CANCELLED } }),
    ]);

    const sums = await this.ridesRepo
      .createQueryBuilder('ride')
      .select('COALESCE(SUM(ride.totalFare), 0)', 'gmv')
      .addSelect('COALESCE(SUM(ride.commissionAmount), 0)', 'revenue')
      .where('ride.status = :status', { status: RideStatus.COMPLETED })
      .getRawOne();

    return {
      totalUsers,
      totalPassengers,
      totalDrivers,
      driversOnline,
      totalRides,
      completedRides,
      cancelledRides,
      totalGmv: parseFloat(sums.gmv).toFixed(2),
      totalPlatformRevenue: parseFloat(sums.revenue).toFixed(2),
    };
  }

  async getRevenueTimeSeries(groupBy: 'day' | 'week' | 'month' = 'day'): Promise<RevenuePoint[]> {
    const rows = await this.ridesRepo
      .createQueryBuilder('ride')
      .select(`to_char(date_trunc('${groupBy}', ride.completedAt), 'YYYY-MM-DD')`, 'period')
      .addSelect('COUNT(*)', 'rideCount')
      .addSelect('COALESCE(SUM(ride.totalFare), 0)', 'gmv')
      .addSelect('COALESCE(SUM(ride.commissionAmount), 0)', 'revenue')
      .where('ride.status = :status', { status: RideStatus.COMPLETED })
      .groupBy('period')
      .orderBy('period', 'ASC')
      .getRawMany();

    return rows.map((r) => ({
      period: r.period,
      rideCount: parseInt(r.rideCount, 10),
      gmv: parseFloat(r.gmv).toFixed(2),
      platformRevenue: parseFloat(r.revenue).toFixed(2),
    }));
  }

  async getRidesByStatus(): Promise<Record<string, number>> {
    const rows = await this.ridesRepo
      .createQueryBuilder('ride')
      .select('ride.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('ride.status')
      .getRawMany();

    const result: Record<string, number> = {};
    for (const row of rows) result[row.status] = parseInt(row.count, 10);
    return result;
  }

  async getTopDrivers(limit = 10) {
    return this.driversRepo
      .createQueryBuilder('driver')
      .leftJoin(User, 'user', 'user.id = driver.userId')
      .select('driver.id', 'driverId')
      .addSelect('user.firstName', 'firstName')
      .addSelect('user.lastName', 'lastName')
      .addSelect('driver.completedTrips', 'completedTrips')
      .addSelect('driver.rating', 'rating')
      .addSelect('driver.level', 'level')
      .orderBy('driver.completedTrips', 'DESC')
      .limit(limit)
      .getRawMany();
  }

  /**
   * Buckets completed-ride pickup points into a coarse grid (~1km cells)
   * and counts rides per cell — a simple, dependency-free heat map feed.
   * Swap for a real geospatial bucket query (PostGIS ST_SnapToGrid) if
   * pickup volume grows large enough that in-memory bucketing gets slow.
   */
  async getPickupHeatmap(): Promise<Array<{ lat: number; lng: number; count: number }>> {
    const rides = await this.ridesRepo.find({
      where: { status: RideStatus.COMPLETED },
      select: { pickupLat: true, pickupLng: true },
    });

    const buckets = new Map<string, { lat: number; lng: number; count: number }>();
    const gridSize = 0.01; // ~1.1km at the equator

    for (const ride of rides) {
      const latBucket = Math.round(ride.pickupLat / gridSize) * gridSize;
      const lngBucket = Math.round(ride.pickupLng / gridSize) * gridSize;
      const key = `${latBucket},${lngBucket}`;

      const existing = buckets.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        buckets.set(key, { lat: latBucket, lng: lngBucket, count: 1 });
      }
    }

    return Array.from(buckets.values()).sort((a, b) => b.count - a.count);
  }

  /** Completed vs cancelled ride counts per period — Overview's revenue chart only shows completed-ride GMV, this is the trip-volume equivalent. */
  async getTripsTrend(groupBy: 'day' | 'week' | 'month' = 'day') {
    const rows = await this.ridesRepo
      .createQueryBuilder('ride')
      .select(`to_char(date_trunc('${groupBy}', COALESCE(ride.completedAt, ride.createdAt)), 'YYYY-MM-DD')`, 'period')
      .addSelect(`COUNT(*) FILTER (WHERE ride.status = 'completed')`, 'completed')
      .addSelect(`COUNT(*) FILTER (WHERE ride.status = 'cancelled')`, 'cancelled')
      .groupBy('period')
      .orderBy('period', 'ASC')
      .getRawMany();

    return rows.map((r) => ({
      period: r.period,
      completed: parseInt(r.completed, 10),
      cancelled: parseInt(r.cancelled, 10),
    }));
  }

  /** Cancellation rate as a percentage per period, not just a running total count. */
  async getCancellationRateTrend(groupBy: 'day' | 'week' | 'month' = 'day') {
    const trend = await this.getTripsTrend(groupBy);
    return trend.map((point) => {
      const total = point.completed + point.cancelled;
      return {
        period: point.period,
        totalRides: total,
        cancelledRides: point.cancelled,
        cancellationRate: total > 0 ? parseFloat(((point.cancelled / total) * 100).toFixed(1)) : 0,
      };
    });
  }

  /**
   * Ride count by hour-of-day (0-23), across all completed rides in
   * history — a demand-shape signal for staffing/surge decisions, not
   * something the Overview cards or revenue chart show at all.
   */
  async getPeakHours() {
    const rows = await this.ridesRepo
      .createQueryBuilder('ride')
      .select(`EXTRACT(HOUR FROM ride.createdAt)`, 'hour')
      .addSelect('COUNT(*)', 'rideCount')
      .where('ride.status = :status', { status: RideStatus.COMPLETED })
      .groupBy('hour')
      .orderBy('hour', 'ASC')
      .getRawMany();

    const byHour = new Map(rows.map((r) => [parseInt(r.hour, 10), parseInt(r.rideCount, 10)]));
    // Fill every hour 0-23 explicitly, including zero-ride hours, so a
    // chart never has a silently missing bar.
    return Array.from({ length: 24 }, (_, hour) => ({ hour, rideCount: byHour.get(hour) ?? 0 }));
  }

  /** Rides/GMV/commission broken down by city — nothing showed this at all before. */
  async getByCity() {
    const rows = await this.ridesRepo
      .createQueryBuilder('ride')
      .select(`COALESCE(ride.city, 'Unknown')`, 'city')
      .addSelect('COUNT(*)', 'rideCount')
      .addSelect('COALESCE(SUM(ride.totalFare), 0)', 'gmv')
      .addSelect('COALESCE(SUM(ride.commissionAmount), 0)', 'commission')
      .where('ride.status = :status', { status: RideStatus.COMPLETED })
      .groupBy('city')
      .orderBy('"gmv"', 'DESC')
      .getRawMany();

    return rows.map((r) => ({
      city: r.city,
      rideCount: parseInt(r.rideCount, 10),
      gmv: parseFloat(r.gmv).toFixed(2),
      commission: parseFloat(r.commission).toFixed(2),
    }));
  }

  /** Rides/GMV broken down by ride category (economy/comfort/xl/etc) — nothing showed this at all before. */
  async getByVehicleCategory() {
    const rows = await this.ridesRepo
      .createQueryBuilder('ride')
      .select('ride.category', 'category')
      .addSelect('COUNT(*)', 'rideCount')
      .addSelect('COALESCE(SUM(ride.totalFare), 0)', 'gmv')
      .where('ride.status = :status', { status: RideStatus.COMPLETED })
      .groupBy('ride.category')
      .orderBy('"gmv"', 'DESC')
      .getRawMany();

    return rows.map((r) => ({
      category: r.category,
      rideCount: parseInt(r.rideCount, 10),
      gmv: parseFloat(r.gmv).toFixed(2),
    }));
  }

  /** New passenger + driver signups per period — a real growth trend, distinct from the Overview cards' point-in-time totals. */
  async getGrowth(groupBy: 'day' | 'week' | 'month' = 'day') {
    const rows = await this.usersRepo
      .createQueryBuilder('user')
      .select(`to_char(date_trunc('${groupBy}', user.createdAt), 'YYYY-MM-DD')`, 'period')
      .addSelect(`COUNT(*) FILTER (WHERE user.role = 'passenger')`, 'newPassengers')
      .addSelect(`COUNT(*) FILTER (WHERE user.role = 'driver')`, 'newDrivers')
      .groupBy('period')
      .orderBy('period', 'ASC')
      .getRawMany();

    return rows.map((r) => ({
      period: r.period,
      newPassengers: parseInt(r.newPassengers, 10),
      newDrivers: parseInt(r.newDrivers, 10),
    }));
  }

  /**
   * "Active" defined as having completed at least one ride within that
   * period — a defensible, commonly-used definition, not the same as
   * "online right now" (which the Overview card already covers for
   * drivers). Distinct passenger/driver counts per period, computed
   * with COUNT(DISTINCT ...) rather than raw ride counts.
   */
  async getActiveUsers(groupBy: 'day' | 'week' | 'month' = 'day') {
    const rows = await this.ridesRepo
      .createQueryBuilder('ride')
      .select(`to_char(date_trunc('${groupBy}', ride.completedAt), 'YYYY-MM-DD')`, 'period')
      .addSelect('COUNT(DISTINCT ride.passengerId)', 'activePassengers')
      .addSelect('COUNT(DISTINCT ride.driverId)', 'activeDrivers')
      .where('ride.status = :status', { status: RideStatus.COMPLETED })
      .groupBy('period')
      .orderBy('period', 'ASC')
      .getRawMany();

    return rows.map((r) => ({
      period: r.period,
      activePassengers: parseInt(r.activePassengers, 10),
      activeDrivers: parseInt(r.activeDrivers, 10),
    }));
  }
}
