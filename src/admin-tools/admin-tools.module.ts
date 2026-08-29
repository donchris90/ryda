import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AdminToolsService } from './admin-tools.service';
import { AdminToolsController } from './admin-tools.controller';
import { SettingsModule } from '../settings/settings.module';
import { FeatureFlagsModule } from '../feature-flags/feature-flags.module';
import { CandidateSearchModule } from '../candidate-search/candidate-search.module';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: 'notifications' },
      { name: 'scheduled-rides' },
      { name: 'reconciliation-settlement' },
    ),
    SettingsModule,
    FeatureFlagsModule,
    CandidateSearchModule,
  ],
  providers: [AdminToolsService],
  controllers: [AdminToolsController],
})
export class AdminToolsModule {}
