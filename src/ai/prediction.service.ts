import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Ride } from '../rides/entities/ride.entity';

export interface HourlyDemandPoint {
  hour: number; // 0-23
  averageRides: number;
  level: 'low' | 'medium' | 'high';
}

/**
 * Statistical demand forecasting — averages historical ride counts per
 * hour-of-day. This is NOT a machine-learning model; there's no training,
 * no feature engineering beyond a groupby, no external AI API (this
 * sandbox has no network path to one anyway). It's an honest, useful
 * heuristic: "Tuesdays at 8am have historically been busy here," not a
 * predictive model that improves with more sophisticated signals.
 */
@Injectable()
export class PredictionService {
  constructor(
    @InjectRepository(Ride)
    private readonly ridesRepo: Repository<Ride>,
  ) {}

  async getHourlyDemandForecast(city?: string): Promise<HourlyDemandPoint[]> {
    const qb = this.ridesRepo
      .createQueryBuilder('ride')
      .select('EXTRACT(HOUR FROM ride.createdAt)', 'hour')
      .addSelect('COUNT(*)', 'count')
      .groupBy('hour')
      .orderBy('hour', 'ASC');

    if (city) qb.andWhere('ride.city = :city', { city });

    const rows = await qb.getRawMany();
    const byHour = new Map<number, number>();
    for (const row of rows) byHour.set(parseInt(row.hour, 10), parseInt(row.count, 10));

    const counts = Array.from(byHour.values());
    const max = Math.max(1, ...counts);

    const points: HourlyDemandPoint[] = [];
    for (let hour = 0; hour < 24; hour++) {
      const count = byHour.get(hour) ?? 0;
      const ratio = count / max;
      points.push({
        hour,
        averageRides: count,
        level: ratio > 0.66 ? 'high' : ratio > 0.33 ? 'medium' : 'low',
      });
    }
    return points;
  }

  async getPeakHours(city?: string, limit = 3): Promise<number[]> {
    const forecast = await this.getHourlyDemandForecast(city);
    return forecast
      .slice()
      .sort((a, b) => b.averageRides - a.averageRides)
      .slice(0, limit)
      .map((p) => p.hour);
  }
}
