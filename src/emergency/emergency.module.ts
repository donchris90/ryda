import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Incident } from './entities/incident.entity';
import { IncidentTimelineEntry } from './entities/incident-timeline-entry.entity';
import { Ride } from '../rides/entities/ride.entity';
import { DriverProfile } from '../drivers/entities/driver-profile.entity';
import { User } from '../users/entities/user.entity';
import { EmergencyService } from './emergency.service';
import { EmergencyController } from './emergency.controller';
import { PassengersModule } from '../passengers/passengers.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Incident, IncidentTimelineEntry, Ride, DriverProfile, User]),
    PassengersModule,
  ],
  providers: [EmergencyService],
  controllers: [EmergencyController],
  exports: [EmergencyService],
})
export class EmergencyModule {}
