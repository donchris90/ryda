import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { RidesService } from '../rides.service';

interface ActivateJobData {
  rideId: string;
}

@Processor('scheduled-rides')
export class ScheduledRideProcessor extends WorkerHost {
  private readonly logger = new Logger(ScheduledRideProcessor.name);

  constructor(private readonly ridesService: RidesService) {
    super();
  }

  async process(job: Job<ActivateJobData>): Promise<void> {
    this.logger.log(`Activating scheduled ride ${job.data.rideId}`);
    await this.ridesService.activateScheduledRide(job.data.rideId);
  }
}
