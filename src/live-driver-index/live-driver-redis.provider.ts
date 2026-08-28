import { Logger, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const LIVE_DRIVER_REDIS_CLIENT = 'LIVE_DRIVER_REDIS_CLIENT';

const logger = new Logger('LiveDriverRedisClient');

/**
 * A dedicated ioredis connection for GEO/hash commands, kept separate from
 * BullMQ's connection (app.module.ts) rather than reused — BullMQ manages
 * its own connection lifecycle internally and doesn't expose it for
 * arbitrary commands, and mixing blocking-queue traffic with high-frequency
 * dispatch commands on the same client is worth avoiding anyway. Same raw
 * ioredis-client pattern RedisHealthIndicator already uses.
 */
export const liveDriverRedisProvider: Provider = {
  provide: LIVE_DRIVER_REDIS_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService) => {
    const client = new Redis({
      host: config.get<string>('redis.host'),
      port: config.get<number>('redis.port'),
      password: config.get<string>('redis.password'),
      // A dispatch-hot-path command should fail fast, not queue up behind
      // a dead connection — callers (LiveDriverIndexService) already treat
      // every Redis operation as best-effort and fail open, so there's no
      // benefit to ioredis retrying internally first.
      maxRetriesPerRequest: 1,
      retryStrategy: (times) => Math.min(times * 500, 5000),
    });

    // ioredis emits 'error' on every failed reconnect attempt — leaving
    // this unhandled would crash the process on a transient Redis outage,
    // which is exactly the single-point-of-failure this index is designed
    // to avoid. Real handling (returning empty results, skipping the
    // index write) lives in LiveDriverIndexService; this just stops the
    // process from going down over it.
    client.on('error', (err) => {
      logger.warn(`Live-driver Redis connection error: ${err.message}`);
    });

    return client;
  },
};
