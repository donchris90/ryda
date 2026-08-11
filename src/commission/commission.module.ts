import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommissionRule } from './entities/commission-rule.entity';
import { Ride } from '../rides/entities/ride.entity';
import { CommissionService } from './commission.service';
import { CommissionController } from './commission.controller';
import { CommissionReportsController } from './commission-reports.controller';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [TypeOrmModule.forFeature([CommissionRule, Ride]), SettingsModule],
  providers: [CommissionService],
  controllers: [CommissionController, CommissionReportsController],
  exports: [CommissionService],
})
export class CommissionModule {}
