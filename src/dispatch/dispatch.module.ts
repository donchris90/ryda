import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RideOffer } from './entities/ride-offer.entity';
import { Ride } from '../rides/entities/ride.entity';
import { DispatchService } from './dispatch.service';
import { DispatchController } from './dispatch.controller';
import { DriversModule } from '../drivers/drivers.module';
import { AiModule } from '../ai/ai.module';
import { FeatureFlagsModule } from '../feature-flags/feature-flags.module';
import { ObservabilityModule } from '../observability/observability.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([RideOffer, Ride]),
    DriversModule,
    AiModule,
    FeatureFlagsModule,
    ObservabilityModule,
  ],
  providers: [DispatchService],
  controllers: [DispatchController],
  exports: [DispatchService],
})
export class DispatchModule {}
