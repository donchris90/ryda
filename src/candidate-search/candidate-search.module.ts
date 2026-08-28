import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DriverProfile } from '../drivers/entities/driver-profile.entity';
import { Vehicle } from '../vehicles/entities/vehicle.entity';
import { LiveDriverIndexModule } from '../live-driver-index/live-driver-index.module';
import { ObservabilityModule } from '../observability/observability.module';
import { CandidateSearchService } from './candidate-search.service';

@Module({
  imports: [TypeOrmModule.forFeature([DriverProfile, Vehicle]), LiveDriverIndexModule, ObservabilityModule],
  providers: [CandidateSearchService],
  exports: [CandidateSearchService],
})
export class CandidateSearchModule {}
