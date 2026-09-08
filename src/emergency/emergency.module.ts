import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Incident } from './entities/incident.entity';
import { IncidentTimelineEntry } from './entities/incident-timeline-entry.entity';
import { RiskAlert } from './entities/risk-alert.entity';
import { SafetyRecording } from './entities/safety-recording.entity';
import { LocationHistory } from '../tracking/entities/location-history.entity';
import { Ride } from '../rides/entities/ride.entity';
import { DriverProfile } from '../drivers/entities/driver-profile.entity';
import { User } from '../users/entities/user.entity';
import { EmergencyService } from './emergency.service';
import { SafetyMonitoringService } from './safety-monitoring.service';
import { SafetyRecordingsService } from './safety-recordings.service';
import { EmergencyController } from './emergency.controller';
import { PassengersModule } from '../passengers/passengers.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Incident, IncidentTimelineEntry, RiskAlert, SafetyRecording, LocationHistory, Ride, DriverProfile, User]),
    PassengersModule,
    StorageModule,
  ],
  providers: [EmergencyService, SafetyMonitoringService, SafetyRecordingsService],
  controllers: [EmergencyController],
  exports: [EmergencyService, SafetyMonitoringService, SafetyRecordingsService],
})
export class EmergencyModule {}
