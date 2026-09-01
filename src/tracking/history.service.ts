import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { LocationHistory } from './entities/location-history.entity';
import { Ride } from '../rides/entities/ride.entity';
import { UserRole, ADMIN_LIKE_ROLES } from '../common/enums/user-role.enum';

// Staff who legitimately need to pull any ride's route for
// investigation/support — mirrors the STAFF_ROLES pattern used by
// RidesService/StorageController for the same kind of check.
const STAFF_ROLES = [...ADMIN_LIKE_ROLES, UserRole.SUPPORT_AGENT, UserRole.DISPATCHER];

@Injectable()
export class HistoryService {
  constructor(
    @InjectRepository(LocationHistory)
    private readonly historyRepo: Repository<LocationHistory>,
    @InjectRepository(Ride)
    private readonly ridesRepo: Repository<Ride>,
  ) {}

  /** Full recorded route for a specific ride, in chronological order. */
  async getRideRoute(rideId: string): Promise<LocationHistory[]> {
    return this.historyRepo.find({ where: { rideId }, order: { recordedAt: 'ASC' } });
  }

  /**
   * IDOR fix (batch 12): GET /tracking/rides/:id/route had no access check
   * at all — the full historical GPS breadcrumb trail of any ride was
   * readable by any authenticated user just by guessing its id. Scoped to
   * the ride's own passenger/driver, or staff.
   */
  async getRideRouteForRequester(
    rideId: string,
    userId: string,
    roles: UserRole[],
  ): Promise<LocationHistory[]> {
    const ride = await this.ridesRepo.findOne({ where: { id: rideId } });
    if (!ride) throw new NotFoundException('Ride not found');

    const isParticipant = ride.passengerId === userId || ride.driverId === userId;
    const isStaff = STAFF_ROLES.some((r) => roles.includes(r));
    if (!isParticipant && !isStaff) {
      throw new ForbiddenException("You don't have access to this ride's route");
    }

    return this.getRideRoute(rideId);
  }

  /** A driver's position history over a time window, regardless of ride. */
  async getDriverHistory(driverUserId: string, from: Date, to: Date): Promise<LocationHistory[]> {
    return this.historyRepo.find({
      where: { driverUserId, recordedAt: Between(from, to) },
      order: { recordedAt: 'ASC' },
    });
  }
}
