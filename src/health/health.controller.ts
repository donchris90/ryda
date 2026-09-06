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

  // Bare liveness check: "is this process up and able to answer HTTP
  // requests at all", with zero dependency checks. Deliberately separate
  // from checkAll() below, which is a readiness/deep-health check that
  // returns 503 if ANY dependency (Paystack, Google Maps, Redis, the
  // dispatch queue) is unhealthy - correct for an ops dashboard, wrong for
  // anything that wants to know "is the network path to this server up",
  // like Render's own health check (render.yaml's healthCheckPath points
  // at plain /health, which never had a route to match it) and the
  // passenger/driver apps' connectivity probe.
  @Get()
  ping() {
    return { status: 'ok' };
  }

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
