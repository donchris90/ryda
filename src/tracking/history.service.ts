import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { LocationHistory } from './entities/location-history.entity';

@Injectable()
export class HistoryService {
  constructor(
    @InjectRepository(LocationHistory)
    private readonly historyRepo: Repository<LocationHistory>,
  ) {}

  /** Full recorded route for a specific ride, in chronological order. */
  async getRideRoute(rideId: string): Promise<LocationHistory[]> {
    return this.historyRepo.find({ where: { rideId }, order: { recordedAt: 'ASC' } });
  }

  /** A driver's position history over a time window, regardless of ride. */
  async getDriverHistory(driverUserId: string, from: Date, to: Date): Promise<LocationHistory[]> {
    return this.historyRepo.find({
      where: { driverUserId, recordedAt: Between(from, to) },
      order: { recordedAt: 'ASC' },
    });
  }
}
