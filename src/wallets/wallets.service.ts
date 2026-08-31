import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository, Between } from 'typeorm';
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
    const wallet = await this.walletsRepo.manager.transaction((manager) =>
      this.creditWithManager(manager, walletId, amount, category, referenceId, description),
    );
    this.events.emit('wallet.updated', { walletId: wallet.id, userId: wallet.userId, direction: 'credit', amount, category });
    this.metricsService.walletTransactionsTotal.inc({ direction: 'credit', category });
    return wallet;
  }

  /**
   * Same credit logic as `credit()`, but runs inside a transaction the
   * *caller* already opened, rather than starting its own. This exists
   * specifically so a caller like PaymentsService.markSuccessFromWebhook
   * can make "mark this payment settled" and "credit the wallet for it"
   * a single atomic unit — see that method's comment for why splitting
   * them into two separate transactions is a real bug (a crash between
   * the two leaves the payment marked SUCCESS with the credit never
   * applied, and unrecoverable, since a retried webhook would then see
   * the payment as already-processed and skip crediting again).
   *
   * Deliberately doesn't emit `wallet.updated`/increment metrics itself —
   * those should only fire once the *caller's* transaction actually
   * commits, not from inside it. Callers using this variant are
   * responsible for emitting/incrementing after their transaction
   * resolves, the same way markSuccessFromWebhook emits `payment.confirmed`
   * only after its own transaction returns.
   */
  async creditWithManager(
    manager: EntityManager,
    walletId: string,
    amount: number,
    category: TransactionCategory,
    referenceId?: string,
    description?: string,
  ): Promise<Wallet> {
    if (amount <= 0) throw new BadRequestException('Amount must be positive');

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

  /**
   * Debits the sender and credits the recipient inside ONE shared
   * transaction — credit() and debit() above each open their own
   * separate transaction, which is fine for a single-sided operation
   * like a top-up, but calling them sequentially for a transfer would
   * leave a real window where a crash between the two calls debits the
   * sender with the recipient never credited. That's exactly the
   * failure mode the transfer requirement explicitly rules out.
   *
   * Locks both wallets in a consistent order (sorted by id, not by
   * sender/recipient role) so two transfers running concurrently
   * between the same two wallets in opposite directions can't deadlock
   * each other by acquiring locks in reversed order.
   */
  async transfer(
    senderWalletId: string,
    recipientWalletId: string,
    amount: number,
    fee: number,
    referenceId: string,
    description: string,
  ): Promise<{ senderWallet: Wallet; recipientWallet: Wallet }> {
    if (amount <= 0) throw new BadRequestException('Amount must be positive');
    if (senderWalletId === recipientWalletId) {
      throw new BadRequestException('Cannot transfer to your own wallet');
    }

    const [firstId, secondId] = [senderWalletId, recipientWalletId].sort();

    const result = await this.walletsRepo.manager.transaction(async (manager) => {
      const first = await manager.findOne(Wallet, { where: { id: firstId }, lock: { mode: 'pessimistic_write' } });
      const second = await manager.findOne(Wallet, { where: { id: secondId }, lock: { mode: 'pessimistic_write' } });
      if (!first || !second) throw new NotFoundException('Wallet not found');

      const senderWallet = first.id === senderWalletId ? first : second;
      const recipientWallet = first.id === senderWalletId ? second : first;

      if (senderWallet.isFrozen) throw new BadRequestException('Your wallet is frozen');
      if (recipientWallet.isFrozen) throw new BadRequestException('The recipient\'s wallet is frozen');

      const totalDebit = amount + fee;
      const senderBalance = parseFloat(senderWallet.balance);
      if (senderBalance < totalDebit) {
        throw new BadRequestException('Insufficient wallet balance');
      }

      const newSenderBalance = senderBalance - totalDebit;
      senderWallet.balance = newSenderBalance.toFixed(2);
      await manager.save(senderWallet);
      await manager.save(WalletTransaction, {
        walletId: senderWallet.id,
        direction: TransactionDirection.DEBIT,
        category: TransactionCategory.TRANSFER_SENT,
        amount: totalDebit.toFixed(2),
        balanceAfter: senderWallet.balance,
        referenceId,
        description,
      });

      const newRecipientBalance = parseFloat(recipientWallet.balance) + amount;
      recipientWallet.balance = newRecipientBalance.toFixed(2);
      await manager.save(recipientWallet);
      await manager.save(WalletTransaction, {
        walletId: recipientWallet.id,
        direction: TransactionDirection.CREDIT,
        category: TransactionCategory.TRANSFER_RECEIVED,
        amount: amount.toFixed(2),
        balanceAfter: recipientWallet.balance,
        referenceId,
        description,
      });

      return { senderWallet, recipientWallet };
    });

    this.events.emit('wallet.updated', {
      walletId: result.senderWallet.id,
      userId: result.senderWallet.userId,
      direction: 'debit',
      amount: amount + fee,
      category: TransactionCategory.TRANSFER_SENT,
    });
    this.events.emit('wallet.updated', {
      walletId: result.recipientWallet.id,
      userId: result.recipientWallet.userId,
      direction: 'credit',
      amount,
      category: TransactionCategory.TRANSFER_RECEIVED,
    });
    this.metricsService.walletTransactionsTotal.inc({ direction: 'debit', category: TransactionCategory.TRANSFER_SENT });
    this.metricsService.walletTransactionsTotal.inc({ direction: 'credit', category: TransactionCategory.TRANSFER_RECEIVED });

    return result;
  }
}
