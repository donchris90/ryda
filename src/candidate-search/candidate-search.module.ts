import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DriverProfile } from '../drivers/entities/driver-profile.entity';
import { DriverServiceCapability } from '../drivers/entities/driver-service-capability.entity';
import { Vehicle } from '../vehicles/entities/vehicle.entity';
import { LiveDriverIndexModule } from '../live-driver-index/live-driver-index.module';
import { ObservabilityModule } from '../observability/observability.module';
import { CandidateSearchService } from './candidate-search.service';
import { CourierMatchDiagnosticService } from './courier-match-diagnostic.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([DriverProfile, Vehicle, DriverServiceCapability]),
    LiveDriverIndexModule,
    ObservabilityModule,
  ],
  providers: [CandidateSearchService, CourierMatchDiagnosticService],
  exports: [CandidateSearchService, CourierMatchDiagnosticService],
})
export class CandidateSearchModule {}
