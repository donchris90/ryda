import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RideCategory } from '../common/enums/ride.enum';
import { haversineDistanceKm } from '../common/utils/geo.util';
import { GoogleMapsService } from '../maps/google-maps.service';
import { SystemSettingsService, SETTING_KEYS } from '../settings/settings.service';

export interface FareBreakdown {
  baseFare: number;
  distanceFare: number;
  timeFare: number;
  surgeMultiplier: number;
  nightMultiplierApplied: number;
  airportFee: number;
  tollFare: number;
  discount: number;
  totalFare: number;
  estimatedDistanceKm: number;
  estimatedDurationMin: number;
  currency: string;
  usedRealRouting: boolean;
}

// Per-category multiplier applied on top of the base economy pricing.
const CATEGORY_MULTIPLIER: Record<RideCategory, number> = {
  [RideCategory.ECONOMY]: 1.0,
  [RideCategory.COMFORT]: 1.25,
  [RideCategory.EXECUTIVE]: 1.6,
  [RideCategory.XL]: 1.5,
  [RideCategory.SUV]: 1.7,
  [RideCategory.ELECTRIC]: 1.15,
  [RideCategory.MOTORCYCLE]: 0.55,
  [RideCategory.TRICYCLE]: 0.65,
  [RideCategory.TAXI]: 1.0,
  [RideCategory.LUXURY]: 2.2,
};

@Injectable()
export class FareService {
  constructor(
    private readonly config: ConfigService,
    private readonly googleMaps: GoogleMapsService,
    private readonly settingsService: SystemSettingsService,
  ) {}

  /**
   * Haversine distance in km between two lat/lng points — the fallback
   * used whenever Google Maps isn't configured (see estimate()).
   */
  calculateDistanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
    return haversineDistanceKm(lat1, lng1, lat2, lng2);
  }

  private estimateDurationMin(distanceKm: number): number {
    const avgSpeedKmh = 28;
    return Math.max(3, Math.round((distanceKm / avgSpeedKmh) * 60));
  }

  /**
   * Resolves distance/duration for a trip. Uses real Google Maps Directions
   * (road distance, traffic-aware duration) when GOOGLE_MAPS_API_KEY is
   * configured; otherwise falls back to Haversine + a flat average speed.
   * Both paths return the same shape so callers don't need to care which
   * one ran.
   */
  private async resolveRoute(
    pickup: { lat: number; lng: number },
    dropoff: { lat: number; lng: number },
  ): Promise<{ distanceKm: number; durationMin: number; usedRealRouting: boolean }> {
    if (this.googleMaps.isConfigured()) {
      const directions = await this.googleMaps.getDirections(pickup, dropoff);
      if (directions) {
        return {
          distanceKm: directions.distanceKm,
          durationMin: directions.durationMin,
          usedRealRouting: true,
        };
      }
      // Directions call failed (bad key, API error, etc) — fall through to Haversine.
    }

    const distanceKm = this.calculateDistanceKm(pickup.lat, pickup.lng, dropoff.lat, dropoff.lng);
    return { distanceKm, durationMin: this.estimateDurationMin(distanceKm), usedRealRouting: false };
  }

  private isNightFare(at: Date = new Date()): boolean {
    const hour = at.getHours();
    const start = this.config.get<number>('pricingExtra.nightStartHour')!;
    const end = this.config.get<number>('pricingExtra.nightEndHour')!;
    // Handles the wraparound case (e.g. 22:00 -> 05:00).
    if (start > end) return hour >= start || hour < end;
    return hour >= start && hour < end;
  }

  async estimate(
    category: RideCategory,
    pickup: { lat: number; lng: number },
    dropoff: { lat: number; lng: number },
    options: { surgeMultiplier?: number; isAirportTrip?: boolean; at?: Date } = {},
  ): Promise<FareBreakdown> {
    const surgeMultiplier = options.surgeMultiplier ?? 1.0;
    const { distanceKm, durationMin, usedRealRouting } = await this.resolveRoute(pickup, dropoff);

    const baseFare = this.config.get<number>('pricing.baseFare')!;
    const perKm = this.config.get<number>('pricing.perKm')!;
    const perMinute = this.config.get<number>('pricing.perMinute')!;
    const minimumFare = this.config.get<number>('pricing.minimumFare')!;
    const currency = this.config.get<string>('pricing.currency')!;
    const airportFeeConfig = this.config.get<number>('pricingExtra.airportFee')!;
    const nightMultiplierConfig = this.config.get<number>('pricingExtra.nightMultiplier')!;

    const multiplier = CATEGORY_MULTIPLIER[category] ?? 1.0;
    const nightMultiplier = this.isNightFare(options.at) ? nightMultiplierConfig : 1.0;
    const airportFee = options.isAirportTrip ? airportFeeConfig : 0;

    const distanceFare = distanceKm * perKm * multiplier;
    const timeFare = durationMin * perMinute * multiplier;
    const rawSubtotal =
      (baseFare * multiplier + distanceFare + timeFare) * surgeMultiplier * nightMultiplier + airportFee;
    const totalFare = Math.max(rawSubtotal, minimumFare);

    return {
      baseFare: this.round(baseFare * multiplier),
      distanceFare: this.round(distanceFare),
      timeFare: this.round(timeFare),
      surgeMultiplier,
      nightMultiplierApplied: nightMultiplier,
      airportFee: this.round(airportFee),
      tollFare: 0,
      discount: 0,
      totalFare: this.round(totalFare),
      estimatedDistanceKm: this.round(distanceKm),
      estimatedDurationMin: durationMin,
      currency,
      usedRealRouting,
    };
  }

  /** Waiting fee once a driver has been at the pickup point past the free-wait grace period. */
  calculateWaitingFee(arrivedAt: Date, rideStartedAt: Date): number {
    const freeMinutes = this.config.get<number>('pricingExtra.freeWaitMinutes')!;
    const perMinuteRate = this.config.get<number>('pricingExtra.perMinuteWaitRate')!;

    const waitedMinutes = Math.max(0, (rideStartedAt.getTime() - arrivedAt.getTime()) / 60000);
    const billableMinutes = Math.max(0, waitedMinutes - freeMinutes);
    return this.round(billableMinutes * perMinuteRate);
  }

  async getCancellationFee(): Promise<number> {
    const envDefault = this.config.get<number>('pricingExtra.cancellationFee')!;
    return this.settingsService.getNumber(SETTING_KEYS.CANCELLATION_FEE, envDefault);
  }

  round(value: number): number {
    return Math.round(value * 100) / 100;
  }
}
