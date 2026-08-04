import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Ride } from '../rides/entities/ride.entity';
import { FavouritePlace } from '../passengers/entities/favourite-place.entity';
import { PredictionService } from './prediction.service';

export interface DriverRecommendation {
  suggestedHours: number[];
  message: string;
}

export interface PassengerRecommendation {
  place: { label: string; address: string; lat: number; lng: number };
  reason: string;
}

@Injectable()
export class RecommendationService {
  constructor(
    @InjectRepository(Ride)
    private readonly ridesRepo: Repository<Ride>,
    @InjectRepository(FavouritePlace)
    private readonly favouritesRepo: Repository<FavouritePlace>,
    private readonly predictionService: PredictionService,
  ) {}

  /** Tells a driver when demand has historically been highest in their city. */
  async getDriverRecommendations(city?: string): Promise<DriverRecommendation> {
    const peakHours = await this.predictionService.getPeakHours(city, 3);
    if (peakHours.length === 0) {
      return { suggestedHours: [], message: 'Not enough historical data yet.' };
    }
    const formatted = peakHours.map((h) => `${h}:00`).join(', ');
    return {
      suggestedHours: peakHours,
      message: `Demand has historically peaked around ${formatted}${city ? ` in ${city}` : ''}.`,
    };
  }

  /**
   * Suggests a saved place the passenger hasn't ridden to recently —
   * simple recency-based surfacing, not a learned preference model.
   */
  async getPassengerRecommendations(passengerId: string): Promise<PassengerRecommendation[]> {
    const favourites = await this.favouritesRepo.find({ where: { userId: passengerId } });
    if (favourites.length === 0) return [];

    const recentRides = await this.ridesRepo.find({
      where: { passengerId },
      order: { createdAt: 'DESC' },
      take: 5,
    });
    const recentAddresses = new Set(recentRides.map((r) => r.dropoffAddress));

    return favourites
      .filter((f) => !recentAddresses.has(f.address))
      .slice(0, 3)
      .map((f) => ({
        place: { label: f.label, address: f.address, lat: f.lat, lng: f.lng },
        reason: `You haven't been to ${f.label} recently.`,
      }));
  }
}
