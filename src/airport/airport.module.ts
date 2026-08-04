import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Airport } from './entities/airport.entity';
import { AirportQueueEntry } from './entities/airport-queue-entry.entity';
import { AirportService } from './airport.service';
import { AirportController } from './airport.controller';
import { FeatureFlagsModule } from '../feature-flags/feature-flags.module';

@Module({
  imports: [TypeOrmModule.forFeature([Airport, AirportQueueEntry]), FeatureFlagsModule],
  providers: [AirportService],
  controllers: [AirportController],
  exports: [AirportService],
})
export class AirportModule {}
