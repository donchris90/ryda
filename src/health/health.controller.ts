import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService, TypeOrmHealthIndicator } from '@nestjs/terminus';
import { DispatchQueueHealthIndicator } from './dispatch-queue.health';
import { MapsHealthIndicator } from './maps.health';
import { PaymentsHealthIndicator } from './payments.health';
import { RedisHealthIndicator } from './redis.health';

@Controller('health')
export class HealthController {
  constructor(
    private readonly healthCheckService: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
    private readonly queue: DispatchQueueHealthIndicator,
    private readonly maps: MapsHealthIndicator,
    private readonly payments: PaymentsHealthIndicator,
    private readonly redis: RedisHealthIndicator,
  ) {}

  @Get('db')
  @HealthCheck()
  checkDb() {
    return this.healthCheckService.check([() => this.db.pingCheck('database')]);
  }

  /** Now a real ping — Redis backs BullMQ queues as of this pass, no longer an honest stub. */
  @Get('redis')
  @HealthCheck()
  checkRedis() {
    return this.healthCheckService.check([() => this.redis.check('redis')]);
  }

  @Get('queue')
  @HealthCheck()
  checkQueue() {
    return this.healthCheckService.check([() => this.queue.check('dispatch_scheduler')]);
  }

  @Get('maps')
  @HealthCheck()
  checkMaps() {
    return this.healthCheckService.check([() => this.maps.check('google_maps')]);
  }

  @Get('payments')
  @HealthCheck()
  checkPayments() {
    return this.healthCheckService.check([() => this.payments.check('paystack')]);
  }

  /** Everything in one call — useful for a single uptime-monitor ping. */
  @Get('all')
  @HealthCheck()
  checkAll() {
    return this.healthCheckService.check([
      () => this.db.pingCheck('database'),
      () => this.queue.check('dispatch_scheduler'),
      () => this.maps.check('google_maps'),
      () => this.payments.check('paystack'),
      () => this.redis.check('redis'),
    ]);
  }
}
