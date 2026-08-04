import { Injectable } from '@nestjs/common';
import { GoogleMapsService } from '../maps/google-maps.service';
import { haversineDistanceKm } from '../common/utils/geo.util';

export interface EtaResult {
  etaMinutes: number;
  distanceKm: number;
  usedRealRouting: boolean;
}

@Injectable()
export class EtaService {
  constructor(private readonly googleMaps: GoogleMapsService) {}

  /** Estimates how long until a driver reaches the pickup point. */
  async estimatePickupEta(
    driver: { lat: number; lng: number },
    pickup: { lat: number; lng: number },
  ): Promise<EtaResult> {
    if (this.googleMaps.isConfigured()) {
      const directions = await this.googleMaps.getDirections(driver, pickup);
      if (directions) {
        return {
          etaMinutes: directions.durationMin,
          distanceKm: directions.distanceKm,
          usedRealRouting: true,
        };
      }
    }

    const distanceKm = haversineDistanceKm(driver.lat, driver.lng, pickup.lat, pickup.lng);
    const avgSpeedKmh = 28;
    const etaMinutes = Math.max(1, Math.round((distanceKm / avgSpeedKmh) * 60));

    return { etaMinutes, distanceKm: Math.round(distanceKm * 100) / 100, usedRealRouting: false };
  }
}
