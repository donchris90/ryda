import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { PaymentRecord, PaymentStatus } from './entities/payment-record.entity';
import { PaystackService } from './paystack/paystack.service';

export type PaystackReconciliationIssueType =
  | 'missing_locally' // Paystack shows a successful transaction we have no payment_records row for at all - a possible missed webhook
  | 'status_mismatch' // our record says SUCCESS, Paystack does not agree it succeeded
  | 'amount_mismatch'; // same reference, but the amount doesn't match

export interface PaystackReconciliationIssue {
  type: PaystackReconciliationIssueType;
  reference: string;
  localStatus: PaymentStatus | null;
  localAmount: string | null;
  paystackStatus: string | null;
  paystackAmountKobo: number | null;
}

export interface PaystackReconciliationReport {
  from: Date;
  to: Date;
  localRecordsChecked: number;
  paystackTransactionsChecked: number;
  issues: PaystackReconciliationIssue[];
}

/**
 * On-demand, date-ranged comparison rather than a continuous background
 * scan (unlike LedgerAuditService's wallet-integrity check) - this is
 * how Paystack-side reconciliation is actually done in practice: an
 * operator picks a window (a day, a settlement period) and asks "did
 * everything Paystack says happened match what we recorded." Read-only:
 * this never corrects anything automatically, since a mismatch here
 * could mean either side is wrong and that needs a human to decide,
 * not an automated fix that might paper over a real problem.
 */
@Injectable()
export class PaystackReconciliationService {
  constructor(
    @InjectRepository(PaymentRecord)
    private readonly paymentsRepo: Repository<PaymentRecord>,
    private readonly paystack: PaystackService,
  ) {}

  async reconcile(from: Date, to: Date): Promise<PaystackReconciliationReport> {
    const [localRecords, paystackTransactions] = await Promise.all([
      this.paymentsRepo.find({ where: { createdAt: Between(from, to) } }),
      this.paystack.listTransactions(from, to),
    ]);

    const localByReference = new Map(localRecords.map((r) => [r.reference, r]));
    const paystackByReference = new Map(paystackTransactions.map((t) => [t.reference, t]));
    const issues: PaystackReconciliationIssue[] = [];

    // Paystack shows a successful transaction we have no local record of
    // at all - simulated payments never reach Paystack in the first
    // place, so those are correctly absent here and not a discrepancy.
    for (const tx of paystackTransactions) {
      if (tx.status !== 'success') continue;
      if (!localByReference.has(tx.reference)) {
        issues.push({
          type: 'missing_locally',
          reference: tx.reference,
          localStatus: null,
          localAmount: null,
          paystackStatus: tx.status,
          paystackAmountKobo: tx.amountKobo,
        });
      }
    }

    // Our own SUCCESS records: does Paystack actually agree, and does
    // the amount match? Simulated payments are deliberately skipped -
    // they were never sent to Paystack in the first place by design
    // (see PaymentsService.chargeSavedCard()'s doc comment), so
    // Paystack having no record of one is expected, not a discrepancy.
    for (const record of localRecords) {
      if (record.status !== PaymentStatus.SUCCESS || record.simulated) continue;

      const tx = paystackByReference.get(record.reference);
      if (!tx || tx.status !== 'success') {
        issues.push({
          type: 'status_mismatch',
          reference: record.reference,
          localStatus: record.status,
          localAmount: record.amount,
          paystackStatus: tx?.status ?? null,
          paystackAmountKobo: tx?.amountKobo ?? null,
        });
        continue;
      }

      const localAmountKobo = Math.round(parseFloat(record.amount) * 100);
      if (Math.abs(localAmountKobo - tx.amountKobo) > 1) {
        // 1 kobo tolerance for rounding, not a loophole for real overage.
        issues.push({
          type: 'amount_mismatch',
          reference: record.reference,
          localStatus: record.status,
          localAmount: record.amount,
          paystackStatus: tx.status,
          paystackAmountKobo: tx.amountKobo,
        });
      }
    }

    return {
      from,
      to,
      localRecordsChecked: localRecords.length,
      paystackTransactionsChecked: paystackTransactions.length,
      issues,
    };
  }
}
