import { Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import { GoogleMapsService } from '../maps/google-maps.service';

/**
 * "Down" here means "running in Haversine-fallback mode," not "broken" —
 * FareService works fine either way. This tells an operator whether real
 * routing is actually active, which is useful information even though the
 * app degrades gracefully without it.
 */
@Injectable()
export class MapsHealthIndicator {
  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    private readonly googleMaps: GoogleMapsService,
  ) {}

  check(key: string) {
    const indicator = this.healthIndicatorService.check(key);
    return this.googleMaps.isConfigured()
      ? indicator.up({ mode: 'google-maps' })
      : indicator.down({ message: 'GOOGLE_MAPS_API_KEY not set — running on Haversine fallback' });
  }
}
