import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DeliveryOrder } from './entities/delivery-order.entity';
import { DeliveryVehicleTypeConfig } from './entities/delivery-vehicle-type-config.entity';
import { LogisticsService } from './logistics.service';
import { LogisticsController } from './logistics.controller';
import { DeliveryVehicleTypesService } from './delivery-vehicle-types.service';
import { DeliveryVehicleTypesController, AdminDeliveryVehicleTypesController } from './delivery-vehicle-types.controller';
import { DriversModule } from '../drivers/drivers.module';
import { VehiclesModule } from '../vehicles/vehicles.module';
import { WalletsModule } from '../wallets/wallets.module';
import { CommissionModule } from '../commission/commission.module';
import { CorporateModule } from '../corporate/corporate.module';
import { FleetModule } from '../fleet/fleet.module';
import { UsersModule } from '../users/users.module';
import { PaymentsModule } from '../payments/payments.module';
import { FeatureFlagsModule } from '../feature-flags/feature-flags.module';
import { ReconciliationModule } from '../reconciliation/reconciliation.module';
import { SettingsModule } from '../settings/settings.module';
import { CandidateSearchModule } from '../candidate-search/candidate-search.module';
import { RankingModule } from '../ranking/ranking.module';
import { PromotionsModule } from '../promotions/promotions.module';
import { ObservabilityModule } from '../observability/observability.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([DeliveryOrder, DeliveryVehicleTypeConfig]),
    DriversModule,
    VehiclesModule,
    WalletsModule,
    CommissionModule,
    CorporateModule,
    FleetModule,
    UsersModule,
    PaymentsModule,
    FeatureFlagsModule,
    ReconciliationModule,
    SettingsModule,
    // Batch 7: courier matching reuses the exact same shared live-driver
    // index + candidate discovery + ETA ranking pipeline rides use — see
    // LogisticsService.requestDelivery()/acceptDelivery() and
    // candidate-search.types.ts's DispatchDomain doc comment for why
    // courier must never grow its own parallel driver-search
    // implementation.
    CandidateSearchModule,
    RankingModule,
    ObservabilityModule,
    // Referral bonuses on first-completed-activity are generic per user
    // account (see PromotionsService.grantReferralBonusIfEligible) - not
    // ride-specific despite the doc comment there. RidesService already
    // calls it for both the passenger and the driver; markDelivered()
    // below does the same for the delivery customer and driver, closing
    // a gap where a courier-only account's referral code could never
    // be honored no matter how many deliveries they completed.
    PromotionsModule,
  ],
  providers: [LogisticsService, DeliveryVehicleTypesService],
  controllers: [LogisticsController, DeliveryVehicleTypesController, AdminDeliveryVehicleTypesController],
  exports: [LogisticsService, DeliveryVehicleTypesService],
})
export class LogisticsModule {}
