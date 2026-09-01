import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PoolMatchingService } from '../pool-matching.service';

interface ResolveWindowJobData {
  rideId: string;
}

@Processor('pool-matching')
export class PoolMatchWindowProcessor extends WorkerHost {
  private readonly logger = new Logger(PoolMatchWindowProcessor.name);

  constructor(private readonly poolMatchingService: PoolMatchingService) {
    super();
  }

  async process(job: Job<ResolveWindowJobData>): Promise<void> {
    this.logger.log(`Resolving pool match window for ride ${job.data.rideId}`);
    await this.poolMatchingService.resolveWindow(job.data.rideId);
  }
}
