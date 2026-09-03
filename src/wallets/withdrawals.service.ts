import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { BankAccount } from './entities/bank-account.entity';
import { WithdrawalRequest, WithdrawalStatus } from './entities/withdrawal-request.entity';
import { WalletsService } from './wallets.service';
import { TransactionCategory } from '../common/enums/transaction.enum';
import { PaystackService } from '../payments/paystack/paystack.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { UsersService } from '../users/users.service';
import { OtpService } from '../otp/otp.service';
import { OtpPurpose } from '../otp/otp-code.entity';

const WITHDRAWAL_REQUEST_TTL_MINUTES = 10;

@Injectable()
export class WithdrawalsService {
  private readonly logger = new Logger(WithdrawalsService.name);

  constructor(
    @InjectRepository(BankAccount)
    private readonly bankAccountsRepo: Repository<BankAccount>,
    @InjectRepository(WithdrawalRequest)
    private readonly withdrawalsRepo: Repository<WithdrawalRequest>,
    private readonly walletsService: WalletsService,
    private readonly paystack: PaystackService,
    private readonly config: ConfigService,
    private readonly events: EventEmitter2,
    private readonly usersService: UsersService,
    private readonly otpService: OtpService,
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
   * Validates everything up front but does NOT touch the wallet or
   * Paystack yet - real gap closed here: this used to debit and call
   * Paystack immediately on a single request with no additional
   * verification beyond the JWT already on the request. Now creates a
   * PENDING request and sends an OTP to the user's verified phone;
   * the actual money movement only happens in confirmWithdrawal()
   * once that code is verified. Same two-step shape as
   * WalletTransfersService.initiate()/confirm(), for the same reason.
   */
  async initiateWithdrawal(userId: string, bankAccountId: string, amount: number) {
    const user = await this.usersService.findById(userId);
    if (!user.phone || !user.isPhoneVerified) {
      throw new BadRequestException(
        'You need a verified phone number on file before you can withdraw — add and verify one first.',
      );
    }

    // Same reasoning as WalletTransfersService.initiate()'s identical
    // check: OTP verification is scoped only to (phone, purpose), not
    // to a specific withdrawalRequestId, so a double-tap creating a
    // second pending request risks the OTP the user actually receives
    // confirming a stale, earlier request instead of the current one.
    const existingPending = await this.withdrawalsRepo.findOne({
      where: { userId, status: WithdrawalStatus.PENDING },
    });
    if (existingPending && existingPending.expiresAt && existingPending.expiresAt > new Date()) {
      throw new ConflictException(
        'You already have a withdrawal awaiting OTP confirmation — confirm or wait for it to expire before starting another.',
      );
    }

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

    // Checked here (not debited yet) so a doomed request never even
    // reaches the OTP step - the actual debit in confirmWithdrawal()
    // re-checks this anyway via WalletsService.debit()'s own row-locked
    // balance check, since the balance could genuinely change in the
    // OTP window.
    const wallet = await this.walletsService.getByUserId(userId);
    if (parseFloat(wallet.balance) < amount) {
      throw new BadRequestException('Insufficient wallet balance');
    }

    const request = await this.withdrawalsRepo.save(
      this.withdrawalsRepo.create({
        userId,
        bankAccountId,
        amount: amount.toFixed(2),
        status: WithdrawalStatus.PENDING,
        reference: `wd_${randomUUID()}`,
        expiresAt: new Date(Date.now() + WITHDRAWAL_REQUEST_TTL_MINUTES * 60 * 1000),
      }),
    );

    const { expiresInSeconds } = await this.otpService.send(user.phone, OtpPurpose.WALLET_WITHDRAWAL);

    return {
      withdrawalRequestId: request.id,
      amount,
      bankAccount: { bankName: bankAccount.bankName, accountNumber: bankAccount.accountNumber, accountName: bankAccount.accountName },
      otpExpiresInSeconds: expiresInSeconds,
      withdrawalRequestExpiresAt: request.expiresAt,
    };
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
  async confirmWithdrawal(userId: string, withdrawalRequestId: string, otpCode: string): Promise<WithdrawalRequest> {
    const request = await this.withdrawalsRepo.findOne({ where: { id: withdrawalRequestId } });
    if (!request) throw new NotFoundException('Withdrawal request not found');

    // A different user confirming someone else's pending withdrawal id
    // must fail cleanly, not silently move someone else's money.
    if (request.userId !== userId) {
      throw new ForbiddenException('This withdrawal request does not belong to you');
    }

    if (request.status !== WithdrawalStatus.PENDING) {
      throw new BadRequestException(`This withdrawal request is already ${request.status}`);
    }

    if (!request.expiresAt || request.expiresAt < new Date()) {
      request.status = WithdrawalStatus.EXPIRED;
      await this.withdrawalsRepo.save(request);
      throw new BadRequestException('This withdrawal request has expired — please start a new withdrawal');
    }

    const user = await this.usersService.findById(userId);
    await this.otpService.verify(user.phone!, otpCode, OtpPurpose.WALLET_WITHDRAWAL);

    const bankAccount = await this.bankAccountsRepo.findOne({ where: { id: request.bankAccountId } });
    if (!bankAccount) throw new NotFoundException('Bank account no longer exists');

    const amount = parseFloat(request.amount);
    const wallet = await this.walletsService.getByUserId(userId);

    await this.walletsService.debit(wallet.id, amount, TransactionCategory.WITHDRAWAL, request.reference, 'Withdrawal to bank account');

    request.status = WithdrawalStatus.PROCESSING;
    await this.withdrawalsRepo.save(request);

    try {
      const transfer = await this.paystack.initiateTransfer({
        amountKobo: Math.round(amount * 100),
        recipientCode: bankAccount.paystackRecipientCode,
        reason: 'Ryda wallet withdrawal',
        reference: request.reference,
      });
      request.paystackTransferCode = transfer.transferCode;
      return this.withdrawalsRepo.save(request);
    } catch (err) {
      // The initiate call itself failed synchronously (not an async
      // transfer.failed webhook later) — refund immediately rather than
      // leave the user's money stuck in a PROCESSING request that will
      // never resolve.
      await this.walletsService.credit(wallet.id, amount, TransactionCategory.WITHDRAWAL, request.reference, 'Withdrawal reversed — could not initiate transfer');
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

  /** Same reasoning as WalletTransfersService.expireStaleRequests() - proactive cleanup for requests simply abandoned, not just the ones someone happens to try confirming after they've gone stale. */
  @Cron(CronExpression.EVERY_HOUR)
  async expireStaleRequests(): Promise<void> {
    const result = await this.withdrawalsRepo
      .createQueryBuilder()
      .update(WithdrawalRequest)
      .set({ status: WithdrawalStatus.EXPIRED })
      .where('status = :status', { status: WithdrawalStatus.PENDING })
      .andWhere('"expiresAt" < :now', { now: new Date() })
      .execute();

    if (result.affected && result.affected > 0) {
      this.logger.log(`Marked ${result.affected} stale withdrawal request(s) as expired.`);
    }
  }
}
