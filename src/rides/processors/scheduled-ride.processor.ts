import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { RidesService } from '../rides.service';

interface ScheduledRideJobData {
  rideId: string;
}

@Processor('scheduled-rides')
export class ScheduledRideProcessor extends WorkerHost {
  private readonly logger = new Logger(ScheduledRideProcessor.name);

  constructor(private readonly ridesService: RidesService) {
    super();
  }

  async process(job: Job<ScheduledRideJobData>): Promise<void> {
    if (job.name === 'remind') {
      this.logger.log(`Sending scheduled-ride reminder for ride ${job.data.rideId}`);
      await this.ridesService.sendScheduledRideReminder(job.data.rideId);
      return;
    }
    this.logger.log(`Activating scheduled ride ${job.data.rideId}`);
    await this.ridesService.activateScheduledRide(job.data.rideId);
  }

  /** The highest-priority of these three failed-job logs - a permanent failure here means a passenger's scheduled ride never actually activates (or never gets reminded), with nobody told unless this is logged clearly. */
  @OnWorkerEvent('failed')
  onFailed(job: Job<ScheduledRideJobData> | undefined, err: Error): void {
    if (!job) return;
    this.logger.error(
      `Scheduled-ride job "${job.name}" permanently failed after ${job.attemptsMade} attempt(s) for ride ${job.data.rideId}: ${err.message}`,
    );
  }
}
