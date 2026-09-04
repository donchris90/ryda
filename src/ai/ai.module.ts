import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Ride } from '../rides/entities/ride.entity';
import { DriverProfile } from '../drivers/entities/driver-profile.entity';
import { FavouritePlace } from '../passengers/entities/favourite-place.entity';
import { PredictionService } from './prediction.service';
import { PricingService } from './pricing.service';
import { DispatchAiService } from './dispatch-ai.service';
import { EtaService } from './eta.service';
import { FraudAiService } from './fraud-ai.service';
import { RecommendationService } from './recommendation.service';
import { EarningsForecastService } from './earnings-forecast.service';
import { AiController } from './ai.controller';
import { MapsModule } from '../maps/maps.module';
import { FraudModule } from '../fraud/fraud.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Ride, DriverProfile, FavouritePlace]),
    MapsModule,
    FraudModule,
  ],
  providers: [
    PredictionService,
    PricingService,
    DispatchAiService,
    EtaService,
    FraudAiService,
    RecommendationService,
    EarningsForecastService,
  ],
  controllers: [AiController],
  exports: [
    PredictionService,
    PricingService,
    DispatchAiService,
    EtaService,
    FraudAiService,
    RecommendationService,
    EarningsForecastService,
  ],
})
export class AiModule {}
