import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { DispatchQueueHealthIndicator } from './dispatch-queue.health';
import { MapsHealthIndicator } from './maps.health';
import { PaymentsHealthIndicator } from './payments.health';
import { RedisHealthIndicator } from './redis.health';
import { DispatchModule } from '../dispatch/dispatch.module';
import { MapsModule } from '../maps/maps.module';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [TerminusModule, DispatchModule, MapsModule, PaymentsModule],
  controllers: [HealthController],
  providers: [DispatchQueueHealthIndicator, MapsHealthIndicator, PaymentsHealthIndicator, RedisHealthIndicator],
})
export class HealthModule {}
