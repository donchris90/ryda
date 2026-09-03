import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
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

  /** This queue has no configured retries currently, so this fires on the very first failure - still worth a clear, distinct log rather than a silent, generic BullMQ failure nobody notices. */
  @OnWorkerEvent('failed')
  onFailed(job: Job<SettleJobData> | undefined, err: Error): void {
    if (!job) return;
    this.logger.error(`Reconciliation settlement job ${job.id} failed for driver ${job.data.driverId}: ${err.message}`);
  }
}
