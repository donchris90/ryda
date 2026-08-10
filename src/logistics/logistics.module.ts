import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DeliveryOrder } from './entities/delivery-order.entity';
import { LogisticsService } from './logistics.service';
import { LogisticsController } from './logistics.controller';
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

@Module({
  imports: [
    TypeOrmModule.forFeature([DeliveryOrder]),
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
  ],
  providers: [LogisticsService],
  controllers: [LogisticsController],
  exports: [LogisticsService],
})
export class LogisticsModule {}
