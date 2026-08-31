import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { OnEvent } from '@nestjs/event-emitter';
import { CashReconciliation, ReconciliationStatus } from './entities/cash-reconciliation.entity';
import { WalletsService } from '../wallets/wallets.service';
import { FleetService } from '../fleet/fleet.service';
import { TransactionCategory } from '../common/enums/transaction.enum';

export interface ReconciliationSummary {
  driverId: string | null;
  fleetCompanyId: string | null;
  totalOwed: string;
  pendingCount: number;
}

@Injectable()
export class ReconciliationService {
  constructor(
    @InjectRepository(CashReconciliation)
    private readonly repo: Repository<CashReconciliation>,
    private readonly walletsService: WalletsService,
    private readonly fleetService: FleetService,
    @InjectQueue('reconciliation-settlement') private readonly settlementQueue: Queue,
  ) {}

  /**
   * Records commission owed on a cash trip that couldn't be debited
   * immediately (insufficient wallet balance) — called from
   * RidesService/LogisticsService instead of letting the debit exception
   * block trip completion.
   */
  async recordDebt(
    driverId: string | null,
    fleetCompanyId: string | null,
    rideId: string,
    amount: number,
  ): Promise<CashReconciliation> {
    return this.repo.save(
      this.repo.create({
        driverId,
        fleetCompanyId,
        rideId,
        amountOwed: amount.toFixed(2),
      }),
    );
  }

  async getOutstandingBalance(driverId: string): Promise<ReconciliationSummary> {
    const pending = await this.repo.find({ where: { driverId, status: ReconciliationStatus.PENDING } });
    const totalOwed = pending.reduce((sum, r) => sum + parseFloat(r.amountOwed), 0);
    return {
      driverId,
      fleetCompanyId: null,
      totalOwed: totalOwed.toFixed(2),
      pendingCount: pending.length,
    };
  }

  async listForDriver(driverId: string): Promise<CashReconciliation[]> {
    return this.repo.find({ where: { driverId }, order: { createdAt: 'DESC' } });
  }

  async listAllPending(): Promise<CashReconciliation[]> {
    return this.repo.find({ where: { status: ReconciliationStatus.PENDING }, order: { createdAt: 'ASC' } });
  }

  /**
   * Aggregate totals for the admin reconciliation dashboard. "Overdue" is
   * deliberately not broken out as its own bucket — nothing in this module
   * currently tracks a due date per debt (they're settled opportunistically
   * whenever the wallet next gets credited, not against a deadline), so an
   * "overdue" figure would have no real definition behind it yet.
   */
  async getSummary(): Promise<{
    pendingCount: number;
    pendingTotal: string;
    settledCount: number;
    settledTotal: string;
    writtenOffCount: number;
    writtenOffTotal: string;
    driversWithPendingDebt: number;
  }> {
    const [pending, settled, writtenOff] = await Promise.all([
      this.repo.find({ where: { status: ReconciliationStatus.PENDING } }),
      this.repo.find({ where: { status: ReconciliationStatus.SETTLED } }),
      this.repo.find({ where: { status: ReconciliationStatus.WRITTEN_OFF } }),
    ]);

    const sum = (rows: CashReconciliation[]) =>
      rows.reduce((total, r) => total + parseFloat(r.amountOwed), 0).toFixed(2);

    return {
      pendingCount: pending.length,
      pendingTotal: sum(pending),
      settledCount: settled.length,
      settledTotal: sum(settled),
      writtenOffCount: writtenOff.length,
      writtenOffTotal: sum(writtenOff),
      driversWithPendingDebt: new Set(pending.map((r) => r.driverId).filter(Boolean)).size,
    };
  }

  async writeOff(id: string, adminUserId: string, reason: string): Promise<CashReconciliation> {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException('Reconciliation item not found');
    if (item.status !== ReconciliationStatus.PENDING) {
      throw new BadRequestException('Only a pending item can be written off');
    }
    item.status = ReconciliationStatus.WRITTEN_OFF;
    item.writtenOffBy = adminUserId;
    item.writeOffReason = reason;
    return this.repo.save(item);
  }

  /**
   * Tries to settle a driver's oldest pending debts, one at a time, up to
   * whatever their wallet balance can currently cover. Each item is
   * all-or-nothing so the ledger stays clean per-trip.
   */
  async attemptSettle(driverId: string): Promise<{ settledCount: number; totalSettled: string }> {
    const pending = await this.repo.find({
      where: { driverId, status: ReconciliationStatus.PENDING },
      order: { createdAt: 'ASC' },
    });

    let settledCount = 0;
    let totalSettled = 0;

    for (const item of pending) {
      const wallet = await this.walletsService.getByUserId(driverId).catch(() => null);
      if (!wallet || parseFloat(wallet.balance) < parseFloat(item.amountOwed)) {
        break; // oldest-first — stop at the first one we can't cover
      }

      await this.walletsService.debit(
        wallet.id,
        parseFloat(item.amountOwed),
        TransactionCategory.COMMISSION,
        item.rideId,
        `Settling reconciled commission debt for trip ${item.rideId}`,
      );

      item.status = ReconciliationStatus.SETTLED;
      item.settledAt = new Date();
      await this.repo.save(item);

      settledCount += 1;
      totalSettled += parseFloat(item.amountOwed);
    }

    return { settledCount, totalSettled: totalSettled.toFixed(2) };
  }

  /**
   * Whenever a driver's wallet gets credited (a ride/delivery earning,
   * top-up, bonus...), it's worth checking whether that new balance can
   * now cover an outstanding cash-commission debt. Enqueued rather than
   * run inline in the event handler, so it doesn't slow down the credit
   * that triggered it.
   */
  @OnEvent('wallet.updated')
  async onWalletUpdated(payload: { userId: string; direction: 'credit' | 'debit' }): Promise<void> {
    if (payload.direction !== 'credit') return;
    await this.settlementQueue.add('attempt-settle', { driverId: payload.userId });
  }
}
