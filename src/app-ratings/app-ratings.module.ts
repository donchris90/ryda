import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppRating } from './entities/app-rating.entity';
import { AppRatingsService } from './app-ratings.service';
import { AppRatingsController } from './app-ratings.controller';

@Module({
  imports: [TypeOrmModule.forFeature([AppRating])],
  providers: [AppRatingsService],
  controllers: [AppRatingsController],
  exports: [AppRatingsService],
})
export class AppRatingsModule {}
