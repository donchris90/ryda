import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { BullModule } from '@nestjs/bullmq';
import { LoggerModule } from 'nestjs-pino';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from './config/config.module';
import { ConfigService } from '@nestjs/config';
import { DatabaseModule } from './database/database.module';
import { CommonModule } from './common/common.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { DriversModule } from './drivers/drivers.module';
import { VehiclesModule } from './vehicles/vehicles.module';
import { RidesModule } from './rides/rides.module';
import { WalletsModule } from './wallets/wallets.module';
import { CommissionModule } from './commission/commission.module';
import { PaymentsModule } from './payments/payments.module';
import { CorporateModule } from './corporate/corporate.module';
import { PassengersModule } from './passengers/passengers.module';
import { PromotionsModule } from './promotions/promotions.module';
import { NotificationsModule } from './notifications/notifications.module';
import { FleetModule } from './fleet/fleet.module';
import { AuditModule } from './audit/audit.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { SupportModule } from './support/support.module';
import { CmsModule } from './cms/cms.module';
import { MapsModule } from './maps/maps.module';
import { AirportModule } from './airport/airport.module';
import { ApiKeysModule } from './api-keys/api-keys.module';
import { FraudModule } from './fraud/fraud.module';
import { LogisticsModule } from './logistics/logistics.module';
import { AdvertisingModule } from './advertising/advertising.module';
import { AiModule } from './ai/ai.module';
import { FeatureFlagsModule } from './feature-flags/feature-flags.module';
import { SettingsModule } from './settings/settings.module';
import { TrackingModule } from './tracking/tracking.module';
import { HealthModule } from './health/health.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { EmergencyModule } from './emergency/emergency.module';
import { StorageModule } from './storage/storage.module';
import { SearchModule } from './search/search.module';
import { IncentivesModule } from './incentives/incentives.module';
import { ReconciliationModule } from './reconciliation/reconciliation.module';
import { ObservabilityModule } from './observability/observability.module';
import { GeofenceModule } from './tracking/geofence/geofence.module';
import { AdminToolsModule } from './admin-tools/admin-tools.module';
import { ChatModule } from './chat/chat.module';
import { SplitFareModule } from './split-fare/split-fare.module';
import { LoyaltyModule } from './loyalty/loyalty.module';
import { MaintenanceModeGuard } from './admin-tools/maintenance-mode.guard';

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        pinoHttp: {
          level: config.get<string>('observability.logLevel'),
          // Pretty-print in dev; plain JSON (production default) is what a
          // real log aggregator — CloudWatch, Loki, Datadog — expects.
          transport:
            config.get<string>('nodeEnv') === 'production'
              ? undefined
              : { target: 'pino-pretty', options: { singleLine: true, colorize: true } },
          redact: ['req.headers.authorization', 'req.headers["x-api-key"]'],
          autoLogging: {
            ignore: (req: any) => req.url === '/api/v1/health' || req.url === '/api/v1/metrics',
          },
        },
      }),
    }),
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('redis.host'),
          port: config.get<number>('redis.port'),
          password: config.get<string>('redis.password'),
        },
      }),
    }),
    ThrottlerModule.forRoot([
      {
        // Default: 100 requests/min per IP across the API.
        name: 'default',
        ttl: 60000,
        limit: 100,
      },
    ]),
    DatabaseModule,
    CommonModule,
    AuthModule,
    UsersModule,
    DriversModule,
    VehiclesModule,
    RidesModule,
    WalletsModule,
    CommissionModule,
    PaymentsModule,
    CorporateModule,
    PassengersModule,
    PromotionsModule,
    NotificationsModule,
    FleetModule,
    AuditModule,
    AnalyticsModule,
    SupportModule,
    CmsModule,
    MapsModule,
    AirportModule,
    ApiKeysModule,
    FraudModule,
    LogisticsModule,
    AdvertisingModule,
    AiModule,
    FeatureFlagsModule,
    SettingsModule,
    TrackingModule,
    HealthModule,
    WebhooksModule,
    EmergencyModule,
    StorageModule,
    SearchModule,
    IncentivesModule,
    ReconciliationModule,
    ObservabilityModule,
    GeofenceModule,
    AdminToolsModule,
    ChatModule,
    SplitFareModule,
    LoyaltyModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: MaintenanceModeGuard },
  ],
})
export class AppModule {}
