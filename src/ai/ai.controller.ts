import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { User } from '../users/entities/user.entity';
import { PredictionService } from './prediction.service';
import { PricingService } from './pricing.service';
import { EtaService } from './eta.service';
import { FraudAiService } from './fraud-ai.service';
import { RecommendationService } from './recommendation.service';
import { EarningsForecastService } from './earnings-forecast.service';

@Controller('ai')
export class AiController {
  constructor(
    private readonly predictionService: PredictionService,
    private readonly pricingService: PricingService,
    private readonly etaService: EtaService,
    private readonly fraudAiService: FraudAiService,
    private readonly recommendationService: RecommendationService,
    private readonly earningsForecastService: EarningsForecastService,
  ) {}

  @Get('demand-forecast')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.DISPATCHER, UserRole.COUNTRY_ADMIN, UserRole.CITY_MANAGER)
  demandForecast(@Query('city') city?: string) {
    return this.predictionService.getHourlyDemandForecast(city);
  }

  @Get('surge')
  surge(@Query('city') city?: string) {
    return this.pricingService.calculateSurge(city);
  }

  @Get('eta')
  eta(
    @Query('driverLat') driverLat: string,
    @Query('driverLng') driverLng: string,
    @Query('pickupLat') pickupLat: string,
    @Query('pickupLng') pickupLng: string,
  ) {
    return this.etaService.estimatePickupEta(
      { lat: parseFloat(driverLat), lng: parseFloat(driverLng) },
      { lat: parseFloat(pickupLat), lng: parseFloat(pickupLng) },
    );
  }

  @Get('fraud-risk/:userId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.SUPPORT_AGENT)
  fraudRisk(@Param('userId') userId: string) {
    return this.fraudAiService.getRiskScore(userId);
  }

  @Get('recommendations/driver')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.DRIVER)
  driverRecommendations(@Query('city') city?: string) {
    return this.recommendationService.getDriverRecommendations(city);
  }

  @Get('recommendations/passenger')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.PASSENGER)
  passengerRecommendations(@CurrentUser() user: User) {
    return this.recommendationService.getPassengerRecommendations(user.id);
  }

  @Get('earnings-forecast')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.DRIVER)
  earningsForecast(@CurrentUser() user: User) {
    return this.earningsForecastService.forecastWeeklyEarnings(user.id);
  }
}
