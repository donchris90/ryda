import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Promotion } from './entities/promotion.entity';
import { PromotionRedemption } from './entities/promotion-redemption.entity';
import { Campaign } from './entities/campaign.entity';
import { ReferralGrant } from './entities/referral-grant.entity';
import { PromotionsService } from './promotions.service';
import { PromotionsController } from './promotions.controller';
import { UsersModule } from '../users/users.module';
import { WalletsModule } from '../wallets/wallets.module';
import { FraudModule } from '../fraud/fraud.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Promotion, PromotionRedemption, Campaign, ReferralGrant]),
    UsersModule,
    WalletsModule,
    FraudModule,
    SettingsModule,
  ],
  providers: [PromotionsService],
  controllers: [PromotionsController],
  exports: [PromotionsService],
})
export class PromotionsModule {}
