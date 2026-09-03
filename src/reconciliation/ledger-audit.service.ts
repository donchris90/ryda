import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Wallet } from '../wallets/entities/wallet.entity';
import { WalletTransaction } from '../wallets/entities/wallet-transaction.entity';
import { FleetWallet } from '../fleet/entities/fleet-wallet.entity';
import { FleetTransaction } from '../fleet/entities/fleet-transaction.entity';
import { CorporateAccount } from '../corporate/entities/corporate-account.entity';
import { CorporateTransaction } from '../corporate/entities/corporate-transaction.entity';
import { TransactionDirection } from '../common/enums/transaction.enum';
import { LedgerDiscrepancy, LedgerDiscrepancyStatus, LedgerAccountType } from './entities/ledger-discrepancy.entity';

export interface ChainCheckResult {
  walletId: string;
  accountType: LedgerAccountType;
  ok: boolean;
  walletBalance: string;
  computedBalance: string;
  brokenAt: { transactionId: string; expectedBalanceAfter: string; actualBalanceAfter: string } | null;
}

/** Per-account-type table/column configuration for the shared scan/chain-check logic below. */
interface AccountTypeConfig {
  accountType: LedgerAccountType;
  walletTable: string;
  txTable: string;
  balanceColumn: string; // "balance" for Wallet/FleetWallet, "budgetBalance" for CorporateAccount
  txWalletIdColumn: string; // "walletId" / "fleetWalletId" / "corporateAccountId"
}

const WALLET_CONFIG: AccountTypeConfig = {
  accountType: LedgerAccountType.WALLET,
  walletTable: 'wallets',
  txTable: 'wallet_transactions',
  balanceColumn: 'balance',
  txWalletIdColumn: 'walletId',
};
const FLEET_CONFIG: AccountTypeConfig = {
  accountType: LedgerAccountType.FLEET_WALLET,
  walletTable: 'fleet_wallets',
  txTable: 'fleet_transactions',
  balanceColumn: 'balance',
  txWalletIdColumn: 'fleetWalletId',
};
const CORPORATE_CONFIG: AccountTypeConfig = {
  accountType: LedgerAccountType.CORPORATE_ACCOUNT,
  walletTable: 'corporate_accounts',
  txTable: 'corporate_transactions',
  balanceColumn: 'budgetBalance',
  txWalletIdColumn: 'corporateAccountId',
};

/**
 * The genuinely missing piece from Batch 4's reconciliation
 * requirements - ReconciliationService (elsewhere in this module)
 * already handles cash-commission debt tracking well; this handles
 * discrepancy detection: does an account's recorded balance actually
 * match what its own transaction ledger says it should be. Covers all
 * three ledger-backed account types confirmed during the Batch 4
 * audit to use the identical row-locked atomic pattern - passenger/
 * driver wallets, fleet wallets, and corporate accounts - not just the
 * first one, extended here rather than left as three separately
 * audited (and separately trusted) systems.
 *
 * Two-tier by design: a cheap, SQL-level scan across every account of
 * a given type runs automatically (daily cron + on-demand), and a
 * deeper per-account full-chain walk is available for investigating
 * anything the quick scan flags, rather than running the expensive
 * check for every account on every scan.
 */
@Injectable()
export class LedgerAuditService {
  private readonly logger = new Logger(LedgerAuditService.name);

  constructor(
    @InjectRepository(Wallet)
    private readonly walletsRepo: Repository<Wallet>,
    @InjectRepository(WalletTransaction)
    private readonly txRepo: Repository<WalletTransaction>,
    @InjectRepository(FleetWallet)
    private readonly fleetWalletsRepo: Repository<FleetWallet>,
    @InjectRepository(FleetTransaction)
    private readonly fleetTxRepo: Repository<FleetTransaction>,
    @InjectRepository(CorporateAccount)
    private readonly corporateAccountsRepo: Repository<CorporateAccount>,
    @InjectRepository(CorporateTransaction)
    private readonly corporateTxRepo: Repository<CorporateTransaction>,
    @InjectRepository(LedgerDiscrepancy)
    private readonly discrepancyRepo: Repository<LedgerDiscrepancy>,
  ) {}

  /**
   * One SQL query, not one per account: finds every account of this
   * type whose current balance doesn't match its own most recent
   * ledger entry's balanceAfter. Cheap enough to run on a schedule
   * regardless of how many accounts or transactions exist - an
   * account with zero transactions (balanceAfter is then NULL) is
   * only flagged if its balance isn't the genuine default of 0, not
   * simply for having no history yet.
   */
  private async scanAccountType(
    config: AccountTypeConfig,
    manager: Repository<any>['manager'],
  ): Promise<{ scanned: number; newDiscrepancies: LedgerDiscrepancy[] }> {
    const [{ count }] = await manager.query(`SELECT COUNT(*)::int AS count FROM "${config.walletTable}"`);

    const rows = await manager.query(`
      SELECT w.id AS "walletId", w."${config.balanceColumn}" AS "walletBalance", latest_tx."balanceAfter" AS "ledgerBalance"
      FROM "${config.walletTable}" w
      LEFT JOIN LATERAL (
        SELECT "balanceAfter" FROM "${config.txTable}" tx
        WHERE tx."${config.txWalletIdColumn}"::text = w.id::text
        ORDER BY tx."createdAt" DESC, tx.id DESC
        LIMIT 1
      ) latest_tx ON true
      WHERE
        (latest_tx."balanceAfter" IS NOT NULL AND latest_tx."balanceAfter" != w."${config.balanceColumn}")
        OR (latest_tx."balanceAfter" IS NULL AND w."${config.balanceColumn}" != 0)
    `);

    const newDiscrepancies: LedgerDiscrepancy[] = [];
    for (const row of rows) {
      const walletBalance = parseFloat(row.walletBalance);
      const ledgerBalance = row.ledgerBalance != null ? parseFloat(row.ledgerBalance) : 0;

      // Don't pile up a duplicate open row for an account already
      // flagged and not yet resolved - each scan run should reflect
      // the current set of problems, not accumulate noise every time
      // it runs.
      const existingOpen = await this.discrepancyRepo.findOne({
        where: { walletId: row.walletId, accountType: config.accountType, status: LedgerDiscrepancyStatus.OPEN },
      });
      if (existingOpen) continue;

      const saved = await this.discrepancyRepo.save(
        this.discrepancyRepo.create({
          accountType: config.accountType,
          walletId: row.walletId,
          walletBalance: walletBalance.toFixed(2),
          ledgerBalance: ledgerBalance.toFixed(2),
          difference: (walletBalance - ledgerBalance).toFixed(2),
        }),
      );
      newDiscrepancies.push(saved);
      this.logger.error(
        `LEDGER DISCREPANCY: type=${config.accountType} account=${row.walletId} balance=${walletBalance} ledgerSaysItShouldBe=${ledgerBalance}`,
      );
    }

    return { scanned: count, newDiscrepancies };
  }

  async runQuickScan(): Promise<{ walletsScanned: number; newDiscrepancies: LedgerDiscrepancy[] }> {
    const result = await this.scanAccountType(WALLET_CONFIG, this.walletsRepo.manager);
    return { walletsScanned: result.scanned, newDiscrepancies: result.newDiscrepancies };
  }

  async runFleetWalletScan(): Promise<{ walletsScanned: number; newDiscrepancies: LedgerDiscrepancy[] }> {
    const result = await this.scanAccountType(FLEET_CONFIG, this.fleetWalletsRepo.manager);
    return { walletsScanned: result.scanned, newDiscrepancies: result.newDiscrepancies };
  }

  async runCorporateAccountScan(): Promise<{ walletsScanned: number; newDiscrepancies: LedgerDiscrepancy[] }> {
    const result = await this.scanAccountType(CORPORATE_CONFIG, this.corporateAccountsRepo.manager);
    return { walletsScanned: result.scanned, newDiscrepancies: result.newDiscrepancies };
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async scheduledScan(): Promise<void> {
    const [walletResult, fleetResult, corporateResult] = await Promise.all([
      this.runQuickScan(),
      this.runFleetWalletScan(),
      this.runCorporateAccountScan(),
    ]);
    const totalNew =
      walletResult.newDiscrepancies.length + fleetResult.newDiscrepancies.length + corporateResult.newDiscrepancies.length;
    if (totalNew > 0) {
      this.logger.error(
        `Scheduled ledger audit found ${totalNew} new discrepancy(ies): ` +
          `${walletResult.newDiscrepancies.length} wallet, ${fleetResult.newDiscrepancies.length} fleet, ${corporateResult.newDiscrepancies.length} corporate.`,
      );
    }
  }

  /**
   * Deeper than the quick scan - walks a single account's entire
   * transaction history in order, verifying every link in the chain
   * (each row's balanceAfter must equal the previous row's balanceAfter
   * adjusted by this row's own amount/direction), not just the latest
   * one. Reserved for investigating an account the quick scan already
   * flagged, rather than run for every account on every scheduled scan.
   */
  async checkWalletChain(walletId: string, accountType: LedgerAccountType = LedgerAccountType.WALLET): Promise<ChainCheckResult> {
    const { walletRepo, txRepo, balanceField } = this.reposFor(accountType);
    const wallet = await walletRepo.findOne({ where: { id: walletId } });
    if (!wallet) throw new NotFoundException('Account not found');

    const idColumn = accountType === LedgerAccountType.FLEET_WALLET
      ? 'fleetWalletId'
      : accountType === LedgerAccountType.CORPORATE_ACCOUNT
        ? 'corporateAccountId'
        : 'walletId';

    const transactions = await txRepo.find({
      where: { [idColumn]: walletId } as any,
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
          accountType,
          ok: false,
          walletBalance: (wallet as any)[balanceField],
          computedBalance: computedBalance.toFixed(2),
          brokenAt: {
            transactionId: tx.id,
            expectedBalanceAfter: computedBalance.toFixed(2),
            actualBalanceAfter: tx.balanceAfter,
          },
        };
      }
    }

    const walletBalance = (wallet as any)[balanceField];
    const ok = Math.abs(computedBalance - parseFloat(walletBalance)) <= 0.01;
    return { walletId, accountType, ok, walletBalance, computedBalance: computedBalance.toFixed(2), brokenAt: null };
  }

  private reposFor(accountType: LedgerAccountType) {
    switch (accountType) {
      case LedgerAccountType.FLEET_WALLET:
        return { walletRepo: this.fleetWalletsRepo, txRepo: this.fleetTxRepo, balanceField: 'balance' };
      case LedgerAccountType.CORPORATE_ACCOUNT:
        return { walletRepo: this.corporateAccountsRepo, txRepo: this.corporateTxRepo, balanceField: 'budgetBalance' };
      default:
        return { walletRepo: this.walletsRepo, txRepo: this.txRepo, balanceField: 'balance' };
    }
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
