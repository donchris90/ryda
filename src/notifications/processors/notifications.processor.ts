import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { NotificationsService } from '../notifications.service';
import { NotificationChannel, NotificationCategory } from '../entities/notification.entity';

interface NotificationJobData {
  userId: string;
  channels: NotificationChannel[];
  title: string;
  body: string;
  metadata?: Record<string, unknown>;
  category?: NotificationCategory;
}

@Processor('notifications')
export class NotificationsProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationsProcessor.name);

  constructor(private readonly notificationsService: NotificationsService) {
    super();
  }

  async process(job: Job<NotificationJobData>): Promise<void> {
    const { userId, channels, title, body, metadata, category } = job.data;
    try {
      await this.notificationsService.notify(userId, channels, title, body, metadata, category);
    } catch (err) {
      this.logger.warn(`Notification delivery failed for user ${userId} (attempt ${job.attemptsMade}): ${(err as Error).message}`);
      throw err; // let BullMQ's retry/backoff handle it
    }
  }

  /** Fires once, after every configured retry is exhausted - the genuinely actionable "this will never be delivered" signal, distinct from the per-attempt warn above. */
  @OnWorkerEvent('failed')
  onFailed(job: Job<NotificationJobData> | undefined, err: Error): void {
    if (!job) return;
    this.logger.error(
      `Notification job ${job.id} permanently failed after ${job.attemptsMade} attempt(s) for user ${job.data.userId}: ${err.message}`,
    );
  }
}
