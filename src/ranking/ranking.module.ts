import { Module } from '@nestjs/common';
import { MapsModule } from '../maps/maps.module';
import { ObservabilityModule } from '../observability/observability.module';
import { DriverRankingService } from './ranking.service';

@Module({
  imports: [MapsModule, ObservabilityModule],
  providers: [DriverRankingService],
  exports: [DriverRankingService],
})
export class RankingModule {}
