import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SystemSetting } from './entities/system-setting.entity';
import { SystemSettingsService } from './settings.service';
import { SettingsController, AppConfigController } from './settings.controller';
import { FeatureFlagsModule } from '../feature-flags/feature-flags.module';

@Module({
  imports: [TypeOrmModule.forFeature([SystemSetting]), FeatureFlagsModule],
  providers: [SystemSettingsService],
  controllers: [SettingsController, AppConfigController],
  exports: [SystemSettingsService],
})
export class SettingsModule {}
