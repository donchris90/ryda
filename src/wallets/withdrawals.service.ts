import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { BankAccount } from './entities/bank-account.entity';
import { WithdrawalRequest, WithdrawalStatus } from './entities/withdrawal-request.entity';
import { WalletsService } from './wallets.service';
import { TransactionCategory } from '../common/enums/transaction.enum';
import { PaystackService } from '../payments/paystack/paystack.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class WithdrawalsService {
  constructor(
    @InjectRepository(BankAccount)
    private readonly bankAccountsRepo: Repository<BankAccount>,
    @InjectRepository(WithdrawalRequest)
    private readonly withdrawalsRepo: Repository<WithdrawalRequest>,
    private readonly walletsService: WalletsService,
    private readonly paystack: PaystackService,
    private readonly config: ConfigService,
    private readonly events: EventEmitter2,
  ) {}

  async listBanks() {
    if (!this.paystack.isConfigured()) return [];
    return this.paystack.listBanks();
  }

  /**
   * Verifies the account against Paystack's own bank records first —
   * never trusts a self-reported name — then registers it as a transfer
   * recipient (required once before any transfer can target it) before
   * saving. Rejects outright, with a clear message, when Paystack isn't
   * configured — better than silently saving an account that could
   * never actually be paid out to.
   */
  async addBankAccount(
    userId: string,
    input: { bankCode: string; bankName: string; accountNumber: string },
  ): Promise<BankAccount> {
    if (!this.paystack.isConfigured()) {
      throw new BadRequestException(
        'Payouts are not configured on this server yet (no PAYSTACK_SECRET_KEY set) — bank accounts cannot be verified or added.',
      );
    }

    const { accountName } = await this.paystack.resolveAccountNumber(input.accountNumber, input.bankCode);
    const { recipientCode } = await this.paystack.createTransferRecipient({
      name: accountName,
      accountNumber: input.accountNumber,
      bankCode: input.bankCode,
    });

    const existingCount = await this.bankAccountsRepo.count({ where: { userId } });

    const account = this.bankAccountsRepo.create({
      userId,
      bankName: input.bankName,
      bankCode: input.bankCode,
      accountNumber: input.accountNumber,
      accountName,
      paystackRecipientCode: recipientCode,
      isDefault: existingCount === 0, // first account added becomes the default automatically
    });
    return this.bankAccountsRepo.save(account);
  }

  async listBankAccounts(userId: string): Promise<BankAccount[]> {
    return this.bankAccountsRepo.find({ where: { userId }, order: { createdAt: 'DESC' } });
  }

  async removeBankAccount(userId: string, id: string): Promise<{ removed: boolean }> {
    const account = await this.bankAccountsRepo.findOne({ where: { id } });
    if (!account || account.userId !== userId) throw new NotFoundException('Bank account not found');
    await this.bankAccountsRepo.remove(account);
    return { removed: true };
  }

  /**
   * Debit-then-transfer, not the reverse: the wallet debit uses
   * WalletsService.debit()'s existing row-locked balance check, so the
   * "insufficient balance" failure mode is already handled correctly by
   * code that's been through this before, rather than reimplemented
   * here. If Paystack's initiate-transfer call itself fails immediately
   * (as opposed to failing later, asynchronously, which the webhook
   * handles), the debit is reversed right away rather than leaving the
   * driver's money in limbo.
   */
  async requestWithdrawal(userId: string, bankAccountId: string, amount: number): Promise<WithdrawalRequest> {
    const minAmount = this.config.get<number>('wallet.minWithdrawalAmount')!;
    if (amount < minAmount) {
      throw new BadRequestException(`Minimum withdrawal amount is ₦${minAmount}.`);
    }

    const bankAccount = await this.bankAccountsRepo.findOne({ where: { id: bankAccountId } });
    if (!bankAccount || bankAccount.userId !== userId) {
      throw new ForbiddenException("That bank account doesn't belong to you.");
    }

    if (!this.paystack.isConfigured()) {
      throw new BadRequestException('Payouts are not configured on this server yet — withdrawals are unavailable.');
    }

    const wallet = await this.walletsService.getByUserId(userId);
    const reference = `wd_${randomUUID()}`;

    await this.walletsService.debit(wallet.id, amount, TransactionCategory.WITHDRAWAL, reference, 'Withdrawal to bank account');

    const request = await this.withdrawalsRepo.save(
      this.withdrawalsRepo.create({
        userId,
        bankAccountId,
        amount: amount.toFixed(2),
        status: WithdrawalStatus.PROCESSING,
        reference,
      }),
    );

    try {
      const transfer = await this.paystack.initiateTransfer({
        amountKobo: Math.round(amount * 100),
        recipientCode: bankAccount.paystackRecipientCode,
        reason: 'Ryda driver withdrawal',
        reference,
      });
      request.paystackTransferCode = transfer.transferCode;
      return this.withdrawalsRepo.save(request);
    } catch (err) {
      // The initiate call itself failed synchronously (not an async
      // transfer.failed webhook later) — refund immediately rather than
      // leave the driver's money stuck in a PROCESSING request that will
      // never resolve.
      await this.walletsService.credit(wallet.id, amount, TransactionCategory.WITHDRAWAL, reference, 'Withdrawal reversed — could not initiate transfer');
      request.status = WithdrawalStatus.FAILED;
      request.failureReason = err instanceof Error ? err.message : 'Could not initiate transfer';
      await this.withdrawalsRepo.save(request);
      throw new BadRequestException('Could not process this withdrawal. Your balance has been refunded.');
    }
  }

  async listWithdrawals(userId: string): Promise<WithdrawalRequest[]> {
    return this.withdrawalsRepo.find({ where: { userId }, order: { createdAt: 'DESC' } });
  }

  /**
   * Called from the Paystack webhook handler on transfer.success /
   * transfer.failed / transfer.reversed. A failed/reversed transfer
   * refunds the wallet — the driver's money was only ever debited on
   * the assumption the transfer would actually go through.
   */
  async handleTransferWebhook(reference: string, succeeded: boolean, failureReason?: string): Promise<void> {
    const request = await this.withdrawalsRepo.findOne({ where: { reference } });
    if (!request || request.status !== WithdrawalStatus.PROCESSING) return; // already settled, or not a withdrawal we know about

    if (succeeded) {
      request.status = WithdrawalStatus.COMPLETED;
      request.completedAt = new Date();
      await this.withdrawalsRepo.save(request);
      this.events.emit('withdrawal.completed', { userId: request.userId, amount: request.amount });
    } else {
      const wallet = await this.walletsService.getByUserId(request.userId);
      await this.walletsService.credit(
        wallet.id,
        parseFloat(request.amount),
        TransactionCategory.WITHDRAWAL,
        request.reference,
        'Withdrawal reversed — transfer failed',
      );
      request.status = WithdrawalStatus.FAILED;
      request.failureReason = failureReason ?? 'Paystack reported the transfer failed';
      await this.withdrawalsRepo.save(request);
      this.events.emit('withdrawal.failed', { userId: request.userId, amount: request.amount });
    }
  }
}
