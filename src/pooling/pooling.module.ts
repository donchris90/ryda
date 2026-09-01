import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { Ride } from '../rides/entities/ride.entity';
import { PoolGroup } from './entities/pool-group.entity';
import { PoolMatchingService } from './pool-matching.service';
import { PoolMatchWindowProcessor } from './processors/pool-match-window.processor';
import { DispatchModule } from '../dispatch/dispatch.module';
import { ObservabilityModule } from '../observability/observability.module';

/**
 * Deliberately does NOT import RidesModule — RidesService depends on
 * PoolMatchingService (to kick off/unwind pooling on request/cancel),
 * so the reverse import would be circular. Everything PoolMatchingService
 * needs from "rides" is just the Ride repository directly.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Ride, PoolGroup]),
    BullModule.registerQueue({ name: 'pool-matching' }),
    DispatchModule,
    ObservabilityModule,
  ],
  providers: [PoolMatchingService, PoolMatchWindowProcessor],
  exports: [PoolMatchingService],
})
export class PoolingModule {}
