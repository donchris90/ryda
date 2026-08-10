import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { Wallet } from './entities/wallet.entity';
import { WalletTransaction } from './entities/wallet-transaction.entity';
import {
  TransactionCategory,
  TransactionDirection,
} from '../common/enums/transaction.enum';
import { SystemSettingsService, SETTING_KEYS } from '../settings/settings.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { MetricsService } from '../observability/metrics.service';

@Injectable()
export class WalletsService {
  constructor(
    @InjectRepository(Wallet)
    private readonly walletsRepo: Repository<Wallet>,
    @InjectRepository(WalletTransaction)
    private readonly txRepo: Repository<WalletTransaction>,
    private readonly settingsService: SystemSettingsService,
    private readonly events: EventEmitter2,
    private readonly metricsService: MetricsService,
  ) {}

  async createForUser(userId: string, currency = 'NGN'): Promise<Wallet> {
    const wallet = this.walletsRepo.create({ userId, currency, balance: '0' });
    return this.walletsRepo.save(wallet);
  }

  async getByUserId(userId: string): Promise<Wallet> {
    const wallet = await this.walletsRepo.findOne({ where: { userId } });
    if (!wallet) throw new NotFoundException('Wallet not found');
    return wallet;
  }

  async getTransactions(userId: string, limit = 50, from?: Date, to?: Date): Promise<WalletTransaction[]> {
    const wallet = await this.getByUserId(userId);
    const where: any = { walletId: wallet.id };
    if (from || to) {
      where.createdAt = Between(from ?? new Date(0), to ?? new Date());
    }
    return this.txRepo.find({
      where,
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  /**
   * A single transaction's full detail — the list endpoint above never
   * had anything to link a tap-through to. Verifies the transaction
   * genuinely belongs to this user's own wallet, not just that some
   * transaction with this id exists — a different user's transaction
   * id should 404, not leak someone else's wallet activity.
   */
  async getTransactionById(userId: string, transactionId: string): Promise<WalletTransaction> {
    const wallet = await this.getByUserId(userId);
    const tx = await this.txRepo.findOne({ where: { id: transactionId, walletId: wallet.id } });
    if (!tx) throw new NotFoundException('Transaction not found');
    return tx;
  }

  /**
   * Credits a wallet and writes a ledger entry. Runs inside a DB transaction
   * so balance updates and the transaction log never drift apart.
   */
  async credit(
    walletId: string,
    amount: number,
    category: TransactionCategory,
    referenceId?: string,
    description?: string,
  ): Promise<Wallet> {
    if (amount <= 0) throw new BadRequestException('Amount must be positive');

    return this.walletsRepo.manager.transaction(async (manager) => {
      const wallet = await manager.findOne(Wallet, {
        where: { id: walletId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!wallet) throw new NotFoundException('Wallet not found');

      const newBalance = parseFloat(wallet.balance) + amount;

      // Enforced on top-ups only, not on earnings/bonuses/cashback settling
      // in — a wallet limit is an AML/funding-source control, not something
      // that should block a driver from being paid for a completed trip.
      if (category === TransactionCategory.TOPUP) {
        const maxBalance = await this.settingsService.getNumber(
          SETTING_KEYS.WALLET_MAX_BALANCE,
          10_000_000,
        );
        if (newBalance > maxBalance) {
          throw new BadRequestException(
            `Top-up would exceed the maximum wallet balance of ${maxBalance}`,
          );
        }
      }

      wallet.balance = newBalance.toFixed(2);
      await manager.save(wallet);

      await manager.save(WalletTransaction, {
        walletId: wallet.id,
        direction: TransactionDirection.CREDIT,
        category,
        amount: amount.toFixed(2),
        balanceAfter: wallet.balance,
        referenceId,
        description,
      });

      return wallet;
    }).then((w) => {
      this.events.emit('wallet.updated', { walletId: w.id, userId: w.userId, direction: 'credit', amount, category });
      this.metricsService.walletTransactionsTotal.inc({ direction: 'credit', category });
      return w;
    });
  }

  async debit(
    walletId: string,
    amount: number,
    category: TransactionCategory,
    referenceId?: string,
    description?: string,
  ): Promise<Wallet> {
    if (amount <= 0) throw new BadRequestException('Amount must be positive');

    return this.walletsRepo.manager.transaction(async (manager) => {
      const wallet = await manager.findOne(Wallet, {
        where: { id: walletId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!wallet) throw new NotFoundException('Wallet not found');
      if (wallet.isFrozen) throw new BadRequestException('Wallet is frozen');

      const currentBalance = parseFloat(wallet.balance);
      if (currentBalance < amount) {
        throw new BadRequestException('Insufficient wallet balance');
      }

      const newBalance = currentBalance - amount;
      wallet.balance = newBalance.toFixed(2);
      await manager.save(wallet);

      await manager.save(WalletTransaction, {
        walletId: wallet.id,
        direction: TransactionDirection.DEBIT,
        category,
        amount: amount.toFixed(2),
        balanceAfter: wallet.balance,
        referenceId,
        description,
      });

      return wallet;
    }).then((w) => {
      this.events.emit('wallet.updated', { walletId: w.id, userId: w.userId, direction: 'debit', amount, category });
      this.metricsService.walletTransactionsTotal.inc({ direction: 'debit', category });
      return w;
    });
  }
}
