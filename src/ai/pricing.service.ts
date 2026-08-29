import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Ride } from '../rides/entities/ride.entity';
import { DriverProfile } from '../drivers/entities/driver-profile.entity';
import { RideStatus } from '../common/enums/ride.enum';
import { DriverApprovalStatus } from '../common/enums/driver-status.enum';
import { DriverService, onlineAvailabilitiesForService } from '../common/enums/driver-service.enum';

export interface SurgeResult {
  multiplier: number;
  openDemand: number;
  availableSupply: number;
  reason: string;
}

const MIN_MULTIPLIER = 1.0;
const MAX_MULTIPLIER = 3.0;

/**
 * Computes surge from the actual current ratio of unmatched ride requests
 * to available drivers in a city — a real formula, not a placeholder. This
 * closes a real gap flagged earlier: surge was previously always
 * caller-supplied with "no live engine" behind it.
 */
@Injectable()
export class PricingService {
  constructor(
    @InjectRepository(Ride)
    private readonly ridesRepo: Repository<Ride>,
    @InjectRepository(DriverProfile)
    private readonly driversRepo: Repository<DriverProfile>,
  ) {}

  async calculateSurge(city?: string): Promise<SurgeResult> {
    const rideWhere: Record<string, unknown> = { status: RideStatus.SEARCHING };
    const driverWhere: Record<string, unknown> = {
      // Surge is a ride-demand/ride-supply signal, so "available
      // supply" here means drivers currently online for RIDES
      // specifically (ONLINE_FOR_RIDES or ONLINE_FOR_BOTH) — a
      // delivery-only driver shouldn't count as ride supply and
      // dampen ride surge pricing.
      availability: In(onlineAvailabilitiesForService(DriverService.RIDE)),
      approvalStatus: DriverApprovalStatus.APPROVED,
    };
    if (city) {
      rideWhere.city = city;
      driverWhere.city = city;
    }

    const [openDemand, availableSupply] = await Promise.all([
      this.ridesRepo.count({ where: rideWhere as any }),
      this.driversRepo.count({ where: driverWhere as any }),
    ]);

    if (availableSupply === 0 && openDemand === 0) {
      return { multiplier: MIN_MULTIPLIER, openDemand, availableSupply, reason: 'No activity' };
    }
    if (availableSupply === 0) {
      return {
        multiplier: MAX_MULTIPLIER,
        openDemand,
        availableSupply,
        reason: 'No drivers available',
      };
    }

    const ratio = openDemand / availableSupply;
    // Below 1 rider-per-driver: no surge. Above that, scale up gradually,
    // capped at 3x so this can't run away unbounded.
    const multiplier = Math.min(MAX_MULTIPLIER, Math.max(MIN_MULTIPLIER, 1 + Math.max(0, ratio - 1) * 0.5));

    return {
      multiplier: Math.round(multiplier * 100) / 100,
      openDemand,
      availableSupply,
      reason:
        multiplier > MIN_MULTIPLIER
          ? `${openDemand} riders waiting vs ${availableSupply} available drivers`
          : 'Supply meets demand',
    };
  }
}
