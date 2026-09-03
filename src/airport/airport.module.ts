import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Airport } from './entities/airport.entity';
import { AirportZone } from './entities/airport-zone.entity';
import { AirportQueueEntry } from './entities/airport-queue-entry.entity';
import { AirportService } from './airport.service';
import { AirportController } from './airport.controller';
import { FeatureFlagsModule } from '../feature-flags/feature-flags.module';
import { DriverProfile } from '../drivers/entities/driver-profile.entity';
import { Vehicle } from '../vehicles/entities/vehicle.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Airport, AirportZone, AirportQueueEntry, DriverProfile, Vehicle]),
    FeatureFlagsModule,
  ],
  providers: [AirportService],
  controllers: [AirportController],
  exports: [AirportService],
})
export class AirportModule {}
