import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Ride } from '../rides/entities/ride.entity';
import { RideStatus } from '../common/enums/ride.enum';

export interface EarningsForecast {
  averageDailyEarnings: number;
  projectedWeeklyEarnings: number;
  basedOnTrips: number;
  currency: string;
}

/** Simple trailing-average projection — not a trend/seasonality model. */
@Injectable()
export class EarningsForecastService {
  constructor(
    @InjectRepository(Ride)
    private readonly ridesRepo: Repository<Ride>,
  ) {}

  async forecastWeeklyEarnings(driverId: string, lookbackDays = 14): Promise<EarningsForecast> {
    const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

    const rides = await this.ridesRepo
      .createQueryBuilder('ride')
      .where('ride.driverId = :driverId', { driverId })
      .andWhere('ride.status = :status', { status: RideStatus.COMPLETED })
      .andWhere('ride.completedAt >= :since', { since })
      .getMany();

    if (rides.length === 0) {
      return { averageDailyEarnings: 0, projectedWeeklyEarnings: 0, basedOnTrips: 0, currency: 'NGN' };
    }

    const totalEarnings = rides.reduce((sum, r) => sum + parseFloat(r.driverEarnings ?? '0'), 0);
    const averageDailyEarnings = totalEarnings / lookbackDays;

    return {
      averageDailyEarnings: Math.round(averageDailyEarnings * 100) / 100,
      projectedWeeklyEarnings: Math.round(averageDailyEarnings * 7 * 100) / 100,
      basedOnTrips: rides.length,
      currency: 'NGN',
    };
  }
}
