import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DriverProfile } from './entities/driver-profile.entity';
import { DriverDocument } from './entities/driver-document.entity';
import { DriversService } from './drivers.service';
import { DriverDocumentsService } from './driver-documents.service';
import { DriversController } from './drivers.controller';
import { FraudModule } from '../fraud/fraud.module';
import { PassengersModule } from '../passengers/passengers.module';

@Module({
  imports: [TypeOrmModule.forFeature([DriverProfile, DriverDocument]), FraudModule, PassengersModule],
  providers: [DriversService, DriverDocumentsService],
  controllers: [DriversController],
  exports: [DriversService, DriverDocumentsService],
})
export class DriversModule {}
