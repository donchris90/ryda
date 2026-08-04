import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdCampaign } from './entities/ad-campaign.entity';
import { BannerAd } from './entities/banner-ad.entity';
import { SponsoredLocation } from './entities/sponsored-location.entity';
import { AdvertisingService } from './advertising.service';
import { AdvertisingController } from './advertising.controller';

@Module({
  imports: [TypeOrmModule.forFeature([AdCampaign, BannerAd, SponsoredLocation])],
  providers: [AdvertisingService],
  controllers: [AdvertisingController],
  exports: [AdvertisingService],
})
export class AdvertisingModule {}
