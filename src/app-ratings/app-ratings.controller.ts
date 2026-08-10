import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { AppRatingsService } from './app-ratings.service';
import { SubmitAppRatingDto } from './dto/submit-app-rating.dto';

@Controller('app-ratings')
export class AppRatingsController {
  constructor(private readonly appRatingsService: AppRatingsService) {}

  // Public — the profile screen's "⭐ 4.8 App rating" display needs
  // this regardless of whether the person has rated yet themselves.
  @Get('summary')
  getSummary() {
    return this.appRatingsService.getSummary();
  }

  @UseGuards(JwtAuthGuard)
  @Get('mine')
  getMine(@CurrentUser() user: User) {
    return this.appRatingsService.getMine(user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('mine')
  submit(@CurrentUser() user: User, @Body() dto: SubmitAppRatingDto) {
    return this.appRatingsService.submit(user.id, dto);
  }
}
