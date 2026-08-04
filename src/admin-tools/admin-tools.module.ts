import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AdminToolsService } from './admin-tools.service';
import { AdminToolsController } from './admin-tools.controller';
import { SettingsModule } from '../settings/settings.module';
import { FeatureFlagsModule } from '../feature-flags/feature-flags.module';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: 'notifications' },
      { name: 'scheduled-rides' },
      { name: 'reconciliation-settlement' },
    ),
    SettingsModule,
    FeatureFlagsModule,
  ],
  providers: [AdminToolsService],
  controllers: [AdminToolsController],
})
export class AdminToolsModule {}
