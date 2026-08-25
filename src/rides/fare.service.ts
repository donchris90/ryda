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
};

// See ride-vehicle-match.util.ts for the full reasoning behind this
// check - TypeScript's Record<K, V> typing does not reliably enforce
// completeness when an object literal uses computed enum-member keys.
// Kept as a real, cheap safeguard even for a 2-entry table.
for (const category of Object.values(RideCategory)) {
  if (!(category in CATEGORY_MULTIPLIER)) {
    throw new Error(`CATEGORY_MULTIPLIER is missing an entry for RideCategory.${category}.`);
  }
}

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

  /**
   * Tiered time-based fare: the first `tierMinutes` of estimated trip
   * duration cost `tierBaseFare` flat. Each additional block of
   * `tierMinutes` (a partial block still counts as a full one, same as
   * how metered taxi fares round up) adds `tierIncrementFare`.
   *
   * Example with the defaults (5 min / ₦1700 / ₦700): a 4-minute trip is
   * ₦1700 flat; an 8-minute trip is ₦1700 + one extra block (minutes 6-10)
   * = ₦2400; an 11-minute trip is ₦1700 + two extra blocks = ₦3100.
   */
  private calculateTieredTimeFare(
    durationMin: number,
    tierMinutes: number,
    tierBaseFare: number,
    tierIncrementFare: number,
  ): number {
    if (durationMin <= tierMinutes) return tierBaseFare;
    const extraMinutes = durationMin - tierMinutes;
    const extraBlocks = Math.ceil(extraMinutes / tierMinutes);
    return tierBaseFare + extraBlocks * tierIncrementFare;
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

    const perKm = await this.settingsService.getNumber(
      SETTING_KEYS.PRICING_PER_KM,
      this.config.get<number>('pricing.perKm')!,
    );
    const tierMinutes = await this.settingsService.getNumber(
      SETTING_KEYS.PRICING_TIER_MINUTES,
      this.config.get<number>('pricing.tierMinutes')!,
    );
    const tierBaseFare = await this.settingsService.getNumber(
      SETTING_KEYS.PRICING_TIER_BASE_FARE,
      this.config.get<number>('pricing.tierBaseFare')!,
    );
    const tierIncrementFare = await this.settingsService.getNumber(
      SETTING_KEYS.PRICING_TIER_INCREMENT_FARE,
      this.config.get<number>('pricing.tierIncrementFare')!,
    );
    const minimumFare = await this.settingsService.getNumber(
      SETTING_KEYS.PRICING_MINIMUM_FARE,
      this.config.get<number>('pricing.minimumFare')!,
    );
    const currency = this.config.get<string>('pricing.currency')!;
    const airportFeeConfig = await this.settingsService.getNumber(
      SETTING_KEYS.PRICING_AIRPORT_FEE,
      this.config.get<number>('pricingExtra.airportFee')!,
    );
    const nightMultiplierConfig = await this.settingsService.getNumber(
      SETTING_KEYS.PRICING_NIGHT_MULTIPLIER,
      this.config.get<number>('pricingExtra.nightMultiplier')!,
    );

    const multiplier = CATEGORY_MULTIPLIER[category] ?? 1.0;
    const nightMultiplier = this.isNightFare(options.at) ? nightMultiplierConfig : 1.0;
    const airportFee = options.isAirportTrip ? airportFeeConfig : 0;

    const distanceFare = distanceKm * perKm * multiplier;
    const timeFare =
      this.calculateTieredTimeFare(durationMin, tierMinutes, tierBaseFare, tierIncrementFare) * multiplier;
    const rawSubtotal = (distanceFare + timeFare) * surgeMultiplier * nightMultiplier + airportFee;
    const totalFare = Math.max(rawSubtotal, minimumFare);

    return {
      // No separate flat base fare anymore — the first time-tier block
      // (tierBaseFare) now covers what baseFare used to. Kept as a field,
      // always 0, so API consumers reading FareBreakdown don't break.
      baseFare: 0,
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
