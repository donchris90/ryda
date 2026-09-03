import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RideOffer } from './entities/ride-offer.entity';
import { Ride } from '../rides/entities/ride.entity';
import { DispatchService } from './dispatch.service';
import { AutoDispatchService } from './auto-dispatch.service';
import { DispatchController } from './dispatch.controller';
import { DriversModule } from '../drivers/drivers.module';
import { AiModule } from '../ai/ai.module';
import { FeatureFlagsModule } from '../feature-flags/feature-flags.module';
import { ObservabilityModule } from '../observability/observability.module';
import { CandidateSearchModule } from '../candidate-search/candidate-search.module';
import { RankingModule } from '../ranking/ranking.module';
import { AirportModule } from '../airport/airport.module';
import { CommissionModule } from '../commission/commission.module';
import { VehiclesModule } from '../vehicles/vehicles.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([RideOffer, Ride]),
    DriversModule,
    AiModule,
    FeatureFlagsModule,
    ObservabilityModule,
    // Batch 6: AUTO dispatch reuses the exact same shared candidate
    // discovery + ETA ranking pipeline MANUAL selection uses — see
    // AutoDispatchService's class doc comment.
    CandidateSearchModule,
    RankingModule,
    AirportModule,
    CommissionModule,
    VehiclesModule,
    UsersModule,
  ],
  providers: [DispatchService, AutoDispatchService],
  controllers: [DispatchController],
  exports: [DispatchService, AutoDispatchService],
})
export class DispatchModule {}

