import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DriverProfile } from './entities/driver-profile.entity';
import { DriverDocument } from './entities/driver-document.entity';
import { DriverAvailabilityLog } from './entities/driver-availability-log.entity';
import { DriverServiceCapability } from './entities/driver-service-capability.entity';
import { Ride } from '../rides/entities/ride.entity';
import { RideOffer } from '../dispatch/entities/ride-offer.entity';
import { DriversService } from './drivers.service';
import { DriverDocumentsService } from './driver-documents.service';
import { DriverAnalyticsService } from './driver-analytics.service';
import { DriversController } from './drivers.controller';
import { DriverAnalyticsController } from './driver-analytics.controller';
import { FraudModule } from '../fraud/fraud.module';
import { PassengersModule } from '../passengers/passengers.module';
import { StorageModule } from '../storage/storage.module';
import { TrackingModule } from '../tracking/tracking.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      DriverProfile,
      DriverDocument,
      DriverAvailabilityLog,
      DriverServiceCapability,
      Ride,
      RideOffer,
    ]),
    FraudModule,
    PassengersModule,
    StorageModule,
    TrackingModule,
  ],
  providers: [DriversService, DriverDocumentsService, DriverAnalyticsService],
  controllers: [DriversController, DriverAnalyticsController],
  exports: [DriversService, DriverDocumentsService, DriverAnalyticsService],
})
export class DriversModule {}
