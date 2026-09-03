import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { Ride } from './entities/ride.entity';
import { RidesService } from './rides.service';
import { RidesController } from './rides.controller';
import { AdminDispatchController } from './admin-dispatch.controller';
import { FareService } from './fare.service';
import { ScheduledRideProcessor } from './processors/scheduled-ride.processor';
import { DriversModule } from '../drivers/drivers.module';
import { VehiclesModule } from '../vehicles/vehicles.module';
import { WalletsModule } from '../wallets/wallets.module';
import { CommissionModule } from '../commission/commission.module';
import { UsersModule } from '../users/users.module';
import { PaymentsModule } from '../payments/payments.module';
import { CorporateModule } from '../corporate/corporate.module';
import { PassengersModule } from '../passengers/passengers.module';
import { PromotionsModule } from '../promotions/promotions.module';
import { FleetModule } from '../fleet/fleet.module';
import { MapsModule } from '../maps/maps.module';
import { DispatchModule } from '../dispatch/dispatch.module';
import { AiModule } from '../ai/ai.module';
import { SettingsModule } from '../settings/settings.module';
import { FeatureFlagsModule } from '../feature-flags/feature-flags.module';
import { ReconciliationModule } from '../reconciliation/reconciliation.module';
import { ObservabilityModule } from '../observability/observability.module';
import { CandidateSearchModule } from '../candidate-search/candidate-search.module';
import { RankingModule } from '../ranking/ranking.module';
import { GeofenceModule } from '../tracking/geofence/geofence.module';
import { AirportModule } from '../airport/airport.module';
import { PoolingModule } from '../pooling/pooling.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Ride]),
    DriversModule,
    VehiclesModule,
    WalletsModule,
    CommissionModule,
    UsersModule,
    PaymentsModule,
    CorporateModule,
    PassengersModule,
    PromotionsModule,
    FleetModule,
    MapsModule,
    DispatchModule,
    AiModule,
    SettingsModule,
    FeatureFlagsModule,
    BullModule.registerQueue({ name: 'scheduled-rides' }),
    ReconciliationModule,
    ObservabilityModule,
    CandidateSearchModule,
    RankingModule,
    GeofenceModule,
    AirportModule,
// Deliberately the only direction this import goes - see
    // PoolingModule's own doc comment for why it can't import
    // RidesModule back.
    PoolingModule,
  ],
  providers: [RidesService, FareService, ScheduledRideProcessor],
  controllers: [RidesController, AdminDispatchController],
  exports: [RidesService, FareService],
})
export class RidesModule {}
