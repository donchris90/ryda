import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Wallet } from '../wallets/entities/wallet.entity';
import { WalletTransaction } from '../wallets/entities/wallet-transaction.entity';
import { TransactionDirection } from '../common/enums/transaction.enum';
import { LedgerDiscrepancy, LedgerDiscrepancyStatus } from './entities/ledger-discrepancy.entity';

export interface ChainCheckResult {
  walletId: string;
  ok: boolean;
  walletBalance: string;
  computedBalance: string;
  brokenAt: { transactionId: string; expectedBalanceAfter: string; actualBalanceAfter: string } | null;
}

/**
 * The genuinely missing piece from Batch 4's reconciliation
 * requirements - ReconciliationService (elsewhere in this module)
 * already handles cash-commission debt tracking well; this handles
 * discrepancy detection: does a wallet's recorded balance actually
 * match what its own transaction ledger says it should be. Two-tier
 * by design: a cheap, SQL-level scan across every wallet runs
 * automatically (daily cron + on-demand), and a deeper per-wallet
 * full-chain walk is available for investigating anything the quick
 * scan flags, rather than running the expensive check for every
 * wallet on every scan.
 */
@Injectable()
export class LedgerAuditService {
  private readonly logger = new Logger(LedgerAuditService.name);

  constructor(
    @InjectRepository(Wallet)
    private readonly walletsRepo: Repository<Wallet>,
    @InjectRepository(WalletTransaction)
    private readonly txRepo: Repository<WalletTransaction>,
    @InjectRepository(LedgerDiscrepancy)
    private readonly discrepancyRepo: Repository<LedgerDiscrepancy>,
  ) {}

  /**
   * One SQL query, not one per wallet: finds every wallet whose current
   * balance doesn't match its own most recent ledger entry's
   * balanceAfter. Cheap enough to run on a schedule regardless of how
   * many wallets or transactions exist - a wallet with zero
   * transactions (balanceAfter is then NULL) is only flagged if its
   * balance isn't the genuine default of 0, not simply for having no
   * history yet.
   */
  async runQuickScan(): Promise<{ walletsScanned: number; newDiscrepancies: LedgerDiscrepancy[] }> {
    const walletsScanned = await this.walletsRepo.count();

    const rows = await this.walletsRepo.manager.query(`
      SELECT w.id AS "walletId", w.balance AS "walletBalance", latest_tx."balanceAfter" AS "ledgerBalance"
      FROM wallets w
      LEFT JOIN LATERAL (
        SELECT "balanceAfter" FROM wallet_transactions wt
        WHERE wt."walletId" = w.id
        ORDER BY wt."createdAt" DESC, wt.id DESC
        LIMIT 1
      ) latest_tx ON true
      WHERE
        (latest_tx."balanceAfter" IS NOT NULL AND latest_tx."balanceAfter" != w.balance)
        OR (latest_tx."balanceAfter" IS NULL AND w.balance != 0)
    `);

    const newDiscrepancies: LedgerDiscrepancy[] = [];
    for (const row of rows) {
      const walletBalance = parseFloat(row.walletBalance);
      const ledgerBalance = row.ledgerBalance != null ? parseFloat(row.ledgerBalance) : 0;

      // Don't pile up a duplicate open row for a wallet already flagged
      // and not yet resolved - each scan run should reflect the
      // current set of problems, not accumulate noise every time it runs.
      const existingOpen = await this.discrepancyRepo.findOne({
        where: { walletId: row.walletId, status: LedgerDiscrepancyStatus.OPEN },
      });
      if (existingOpen) continue;

      const saved = await this.discrepancyRepo.save(
        this.discrepancyRepo.create({
          walletId: row.walletId,
          walletBalance: walletBalance.toFixed(2),
          ledgerBalance: ledgerBalance.toFixed(2),
          difference: (walletBalance - ledgerBalance).toFixed(2),
        }),
      );
      newDiscrepancies.push(saved);
      this.logger.error(
        `LEDGER DISCREPANCY: wallet=${row.walletId} balance=${walletBalance} ledgerSaysItShouldBe=${ledgerBalance}`,
      );
    }

    return { walletsScanned, newDiscrepancies };
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async scheduledScan(): Promise<void> {
    const result = await this.runQuickScan();
    if (result.newDiscrepancies.length > 0) {
      this.logger.error(
        `Scheduled ledger audit found ${result.newDiscrepancies.length} new discrepancy(ies) across ${result.walletsScanned} wallets.`,
      );
    }
  }

  /**
   * Deeper than the quick scan - walks a single wallet's entire
   * transaction history in order, verifying every link in the chain
   * (each row's balanceAfter must equal the previous row's balanceAfter
   * adjusted by this row's own amount/direction), not just the latest
   * one. Reserved for investigating a wallet the quick scan already
   * flagged, rather than run for every wallet on every scheduled scan -
   * genuinely more expensive at scale, and the quick scan already tells
   * you which wallets are worth this deeper look.
   */
  async checkWalletChain(walletId: string): Promise<ChainCheckResult> {
    const wallet = await this.walletsRepo.findOne({ where: { id: walletId } });
    if (!wallet) throw new NotFoundException('Wallet not found');

    const transactions = await this.txRepo.find({
      where: { walletId },
      order: { createdAt: 'ASC', id: 'ASC' },
    });

    let computedBalance = 0;
    for (const tx of transactions) {
      const amount = parseFloat(tx.amount);
      computedBalance += tx.direction === TransactionDirection.CREDIT ? amount : -amount;
      const actualBalanceAfter = parseFloat(tx.balanceAfter);

      if (Math.abs(computedBalance - actualBalanceAfter) > 0.01) {
        return {
          walletId,
          ok: false,
          walletBalance: wallet.balance,
          computedBalance: computedBalance.toFixed(2),
          brokenAt: {
            transactionId: tx.id,
            expectedBalanceAfter: computedBalance.toFixed(2),
            actualBalanceAfter: tx.balanceAfter,
          },
        };
      }
    }

    const ok = Math.abs(computedBalance - parseFloat(wallet.balance)) <= 0.01;
    return { walletId, ok, walletBalance: wallet.balance, computedBalance: computedBalance.toFixed(2), brokenAt: null };
  }

  async listOpenDiscrepancies(): Promise<LedgerDiscrepancy[]> {
    return this.discrepancyRepo.find({ where: { status: LedgerDiscrepancyStatus.OPEN }, order: { detectedAt: 'DESC' } });
  }

  async resolve(id: string, adminUserId: string, note: string): Promise<LedgerDiscrepancy> {
    const item = await this.discrepancyRepo.findOne({ where: { id } });
    if (!item) throw new NotFoundException('Discrepancy not found');
    if (item.status !== LedgerDiscrepancyStatus.OPEN) {
      throw new BadRequestException('This discrepancy is already resolved');
    }
    item.status = LedgerDiscrepancyStatus.RESOLVED;
    item.resolvedBy = adminUserId;
    item.resolutionNote = note;
    item.resolvedAt = new Date();
    return this.discrepancyRepo.save(item);
  }
}
