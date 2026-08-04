import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisHealthIndicator implements OnModuleDestroy {
  private readonly client: Redis;

  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    private readonly config: ConfigService,
  ) {
    this.client = new Redis({
      host: this.config.get<string>('redis.host'),
      port: this.config.get<number>('redis.port'),
      password: this.config.get<string>('redis.password'),
      lazyConnect: true,
      retryStrategy: () => null, // don't keep retrying forever just for a health check
    });
  }

  async check(key: string) {
    const indicator = this.healthIndicatorService.check(key);
    try {
      if (this.client.status === 'end' || this.client.status === 'wait') {
        await this.client.connect();
      }
      const pong = await this.client.ping();
      return pong === 'PONG'
        ? indicator.up()
        : indicator.down({ message: `Unexpected PING response: ${pong}` });
    } catch (err) {
      return indicator.down({ message: (err as Error).message });
    }
  }

  onModuleDestroy() {
    this.client.disconnect();
  }
}
