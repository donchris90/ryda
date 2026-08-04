import { Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import { DispatchService } from '../dispatch/dispatch.service';

const EXPECTED_INTERVAL_MS = 15000;
const STALE_THRESHOLD_MS = EXPECTED_INTERVAL_MS * 3; // 3 missed cycles = something's wrong

/**
 * There's no real job queue here (see README — that's a genuine
 * infrastructure gap, not something fakeable in this sandbox), so "queue
 * health" is reframed honestly as "is the in-process dispatch scheduler
 * actually still ticking" — a real, useful signal even without Redis/BullMQ
 * behind it.
 */
@Injectable()
export class DispatchQueueHealthIndicator {
  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    private readonly dispatchService: DispatchService,
  ) {}

  async check(key: string) {
    const indicator = this.healthIndicatorService.check(key);
    const lastRun = this.dispatchService.lastSweepAt;

    if (!lastRun) {
      return indicator.down({ message: 'Dispatch sweep has not run yet since boot' });
    }

    const ageMs = Date.now() - lastRun.getTime();
    if (ageMs > STALE_THRESHOLD_MS) {
      return indicator.down({ message: `Last sweep was ${Math.round(ageMs / 1000)}s ago — expected every 15s` });
    }

    return indicator.up({ lastRunAgo: `${Math.round(ageMs / 1000)}s` });
  }
}
