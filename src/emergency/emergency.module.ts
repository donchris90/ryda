import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Incident } from './entities/incident.entity';
import { IncidentTimelineEntry } from './entities/incident-timeline-entry.entity';
import { RiskAlert } from './entities/risk-alert.entity';
import { LocationHistory } from '../tracking/entities/location-history.entity';
import { Ride } from '../rides/entities/ride.entity';
import { DriverProfile } from '../drivers/entities/driver-profile.entity';
import { User } from '../users/entities/user.entity';
import { EmergencyService } from './emergency.service';
import { SafetyMonitoringService } from './safety-monitoring.service';
import { EmergencyController } from './emergency.controller';
import { PassengersModule } from '../passengers/passengers.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Incident, IncidentTimelineEntry, RiskAlert, LocationHistory, Ride, DriverProfile, User]),
    PassengersModule,
  ],
  providers: [EmergencyService, SafetyMonitoringService],
  controllers: [EmergencyController],
  exports: [EmergencyService, SafetyMonitoringService],
})
export class EmergencyModule {}
