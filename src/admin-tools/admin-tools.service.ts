import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { SystemSettingsService, SETTING_KEYS } from '../settings/settings.service';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';

export interface QueueStats {
  name: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}

@Injectable()
export class AdminToolsService {
  constructor(
    @InjectQueue('notifications') private readonly notificationsQueue: Queue,
    @InjectQueue('scheduled-rides') private readonly scheduledRidesQueue: Queue,
    @InjectQueue('reconciliation-settlement') private readonly reconciliationQueue: Queue,
    private readonly settingsService: SystemSettingsService,
    private readonly featureFlagsService: FeatureFlagsService,
  ) {}

  /** Real BullMQ job counts per queue — not a mock dashboard. */
  async getQueueStats(): Promise<QueueStats[]> {
    const queues: { name: string; queue: Queue }[] = [
      { name: 'notifications', queue: this.notificationsQueue },
      { name: 'scheduled-rides', queue: this.scheduledRidesQueue },
      { name: 'reconciliation-settlement', queue: this.reconciliationQueue },
    ];

    return Promise.all(
      queues.map(async ({ name, queue }) => {
        const counts = await queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
        return {
          name,
          waiting: counts.waiting ?? 0,
          active: counts.active ?? 0,
          completed: counts.completed ?? 0,
          failed: counts.failed ?? 0,
          delayed: counts.delayed ?? 0,
        };
      }),
    );
  }

  clearSettingsCache(): { clearedEntries: number } {
    return { clearedEntries: this.settingsService.clearCache() };
  }

  async getMaintenanceMode(): Promise<boolean> {
    return this.settingsService.getBoolean(SETTING_KEYS.MAINTENANCE_MODE, false);
  }

  async setMaintenanceMode(enabled: boolean, adminUserId: string): Promise<{ maintenanceMode: boolean }> {
    await this.settingsService.set(SETTING_KEYS.MAINTENANCE_MODE, adminUserId, {
      value: String(enabled),
      description: 'Global maintenance mode — blocks all non-admin/auth/health traffic when true',
    });
    return { maintenanceMode: enabled };
  }

  async getDiagnostics() {
    const [queueStats, maintenanceMode, featureFlags] = await Promise.all([
      this.getQueueStats(),
      this.getMaintenanceMode(),
      this.featureFlagsService.listAll(),
    ]);

    const memory = process.memoryUsage();

    return {
      node: {
        version: process.version,
        platform: process.platform,
        uptimeSeconds: Math.round(process.uptime()),
        pid: process.pid,
      },
      memory: {
        rssMb: Math.round(memory.rss / 1024 / 1024),
        heapUsedMb: Math.round(memory.heapUsed / 1024 / 1024),
        heapTotalMb: Math.round(memory.heapTotal / 1024 / 1024),
      },
      maintenanceMode,
      queues: queueStats,
      featureFlags: featureFlags.map((f) => ({ key: f.key, isEnabled: f.isEnabled })),
      timestamp: new Date().toISOString(),
    };
  }
}
