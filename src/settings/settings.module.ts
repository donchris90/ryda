import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SystemSetting } from './entities/system-setting.entity';
import { SystemSettingsService } from './settings.service';
import { SettingsController } from './settings.controller';

@Module({
  imports: [TypeOrmModule.forFeature([SystemSetting])],
  providers: [SystemSettingsService],
  controllers: [SettingsController],
  exports: [SystemSettingsService],
})
export class SettingsModule {}
