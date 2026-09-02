import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MapsModule } from '../maps/maps.module';
import { ObservabilityModule } from '../observability/observability.module';
import { DriverRankingService } from './ranking.service';
import { RideOffer } from '../dispatch/entities/ride-offer.entity';

@Module({
  imports: [MapsModule, ObservabilityModule, TypeOrmModule.forFeature([RideOffer])],
  providers: [DriverRankingService],
  exports: [DriverRankingService],
})
export class RankingModule {}
