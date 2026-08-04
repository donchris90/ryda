import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { ReconciliationService } from '../reconciliation.service';

interface SettleJobData {
  driverId: string;
}

@Processor('reconciliation-settlement')
export class ReconciliationSettlementProcessor extends WorkerHost {
  private readonly logger = new Logger(ReconciliationSettlementProcessor.name);

  constructor(private readonly reconciliationService: ReconciliationService) {
    super();
  }

  async process(job: Job<SettleJobData>): Promise<void> {
    const result = await this.reconciliationService.attemptSettle(job.data.driverId);
    if (result.settledCount > 0) {
      this.logger.log(
        `Auto-settled ${result.settledCount} reconciliation item(s) for driver ${job.data.driverId}, total ${result.totalSettled}`,
      );
    }
  }
}
