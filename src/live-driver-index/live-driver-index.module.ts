import { Inject, Module, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';
import { LiveDriverIndexService } from './live-driver-index.service';
import { liveDriverRedisProvider, LIVE_DRIVER_REDIS_CLIENT } from './live-driver-redis.provider';
import { ObservabilityModule } from '../observability/observability.module';

/**
 * Standalone, reusable module — no dependency on DriversModule/RidesModule/
 * LogisticsModule. It only listens for the two events those modules already
 * emit (`driver.location.updated`, `driver.availability.changed`) and
 * exposes LiveDriverIndexService for the candidate-search engine (batch 3)
 * to inject. Keeping this decoupled is what lets rides, courier, and any
 * future dispatch service share one index without importing each other.
 */
@Module({
  imports: [ObservabilityModule],
  providers: [liveDriverRedisProvider, LiveDriverIndexService],
  exports: [LiveDriverIndexService],
})
export class LiveDriverIndexModule implements OnApplicationShutdown, OnModuleInit {
  constructor(
    @Inject(LIVE_DRIVER_REDIS_CLIENT) private readonly redis: Redis,
    private readonly liveDriverIndex: LiveDriverIndexService,
  ) {}

  private intervalHandle?: ReturnType<typeof setInterval>;

  /**
   * available_driver_count (batch 9) — sampled every 15s rather than
   * recomputed per-request. A dedicated setInterval rather than
   * @Interval() on the service itself, since LiveDriverIndexService is
   * constructed directly (new-able, no DI decorators required) by tests
   * elsewhere in the codebase, and this keeps that usage unaffected.
   */
  onModuleInit(): void {
    this.intervalHandle = setInterval(() => {
      void this.liveDriverIndex.refreshAvailableDriverCountMetric();
    }, 15000);
    this.intervalHandle.unref?.();
  }

  onApplicationShutdown(): void {
    if (this.intervalHandle) clearInterval(this.intervalHandle);
    this.redis.disconnect();
  }
}
