import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Incentive } from './entities/incentive.entity';
import { DriverIncentiveProgress } from './entities/driver-incentive-progress.entity';
import { IncentivesService } from './incentives.service';
import { IncentivesController } from './incentives.controller';
import { DriversModule } from '../drivers/drivers.module';
import { WalletsModule } from '../wallets/wallets.module';

@Module({
  imports: [TypeOrmModule.forFeature([Incentive, DriverIncentiveProgress]), DriversModule, WalletsModule],
  providers: [IncentivesService],
  controllers: [IncentivesController],
  exports: [IncentivesService],
})
export class IncentivesModule {}
