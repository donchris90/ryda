import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserDevice } from './entities/user-device.entity';
import { FraudFlag } from './entities/fraud-flag.entity';
import { FraudService } from './fraud.service';
import { RiskEngineService } from './risk-engine.service';
import { FraudController } from './fraud.controller';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [TypeOrmModule.forFeature([UserDevice, FraudFlag]), SettingsModule],
  providers: [FraudService, RiskEngineService],
  controllers: [FraudController],
  exports: [FraudService, RiskEngineService],
})
export class FraudModule {}
