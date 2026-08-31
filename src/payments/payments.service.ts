import {
  BadRequestException,
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { PaymentRecord, PaymentStatus } from './entities/payment-record.entity';
import { SavedCard } from './entities/saved-card.entity';
import { PaymentMethod } from '../common/enums/ride.enum';
import { PaystackService } from './paystack/paystack.service';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { WalletsService } from '../wallets/wallets.service';
import { TransactionCategory } from '../common/enums/transaction.enum';
import { User } from '../users/entities/user.entity';

export interface ChargeResult {
  record: PaymentRecord;
  /** Where the passenger completes the transfer (Paystack-hosted instructions page). */
  authorizationUrl?: string;
}

@Injectable()
export class PaymentsService {
  constructor(
    @InjectRepository(PaymentRecord)
    private readonly paymentsRepo: Repository<PaymentRecord>,
    @InjectRepository(SavedCard)
    private readonly savedCardsRepo: Repository<SavedCard>,
    private readonly paystack: PaystackService,
    private readonly config: ConfigService,
    private readonly events: EventEmitter2,
    @Inject(forwardRef(() => WalletsService))
    private readonly walletsService: WalletsService,
  ) {}

  // ---------------------------------------------------------------------
  // Card on file
  // ---------------------------------------------------------------------

  /**
   * Starts the one-time hosted-checkout flow used to tokenize a card. A
   * small verification charge is made (refunded automatically once the
   * webhook confirms) and Paystack returns a reusable authorization_code
   * that subsequent rides charge directly with no redirect.
   */
  async initCardAdd(
    userId: string,
    email: string,
  ): Promise<{ authorizationUrl: string; reference: string }> {
    if (!this.paystack.isConfigured()) {
      throw new BadRequestException(
        'Card payments are not available — PAYSTACK_SECRET_KEY is not configured on this server',
      );
    }
    const amountKobo = this.config.get<number>(
      'paystack.cardVerificationKobo',
    )!;
    const reference = `card-verify-${randomUUID()}`;

    await this.paymentsRepo.save(
      this.paymentsRepo.create({
        rideId: null,
        userId,
        method: PaymentMethod.CARD,
        amount: (amountKobo / 100).toFixed(2),
        status: PaymentStatus.PENDING,
        reference,
      }),
    );

    const init = await this.paystack.initializeTransaction({
      email,
      amountKobo,
      reference,
      channels: ['card'],
      metadata: { purpose: 'card_verification', userId },
      callbackUrl: 'rydapassengerapp://card-add-complete',
    });

    return { authorizationUrl: init.authorizationUrl, reference };
  }

  /**
   * Real Paystack hosted checkout for wallet top-ups — replaces a
   * previous endpoint that took a raw amount from the request body and
   * credited the wallet directly with zero payment verification at
   * all. Any authenticated user could call that with any amount and
   * get free money credited instantly; found from a live report that
   * it was still doing this even with real Paystack keys configured,
   * because it never called Paystack in the first place. The wallet
   * only actually gets credited once the webhook below confirms a real
   * charge.success — never here, and never based on anything the
   * client claims.
   */
  async initWalletTopUp(
    userId: string,
    email: string,
    amount: number,
  ): Promise<{ authorizationUrl: string; reference: string }> {
    if (!this.paystack.isConfigured()) {
      throw new BadRequestException(
        'Wallet top-up is not available — PAYSTACK_SECRET_KEY is not configured on this server',
      );
    }
    const minAmount = this.config.get<number>('wallet.minTopUpAmount')!;
    if (amount < minAmount)
      throw new BadRequestException(`Minimum top-up amount is ₦${minAmount}.`);

    const reference = `wallet-topup-${randomUUID()}`;
    await this.paymentsRepo.save(
      this.paymentsRepo.create({
        rideId: null,
        userId,
        method: PaymentMethod.CARD,
        amount: amount.toFixed(2),
        status: PaymentStatus.PENDING,
        reference,
      }),
    );

    const init = await this.paystack.initializeTransaction({
      email,
      amountKobo: Math.round(amount * 100),
      reference,
      channels: ['card', 'bank_transfer', 'ussd'],
      metadata: { purpose: 'wallet_topup', userId },
      // Without this, Paystack shows its own generic success page in
      // the browser with no automatic way back into the app — the
      // user has to manually switch back, and the wallet doesn't
      // visibly update until they do. This deep-links straight back
      // to the passenger app (see rydapassengerapp:// scheme in
      // app.config.js), where a Linking listener catches it and
      // triggers a real balance refresh, not just relying on
      // useFocusEffect firing whenever the user happens to return.
      callbackUrl: 'rydapassengerapp://wallet-topup-complete',
    });

    return { authorizationUrl: init.authorizationUrl, reference };
  }

  /**
   * Called from the webhook once Paystack confirms a wallet-topup
   * charge actually succeeded. Uses the amount stored on our own
   * PaymentRecord (set at init time from the user's request), not
   * anything in the webhook payload itself — the signature check
   * already prevents a tampered payload, but crediting from our own
   * record is the more robust pattern regardless.
   */
  /**
   * Was called separately by the webhook controller after
   * markSuccessFromWebhook() returned — kept as a thin wrapper (still
   * used nowhere else) but no longer the actual crediting path for the
   * webhook itself. See markSuccessFromWebhook()'s comment for why that
   * split was a real bug.
   */
  async creditWalletFromTopUp(record: PaymentRecord): Promise<void> {
    const wallet = await this.walletsService.getByUserId(record.userId);
    await this.walletsService.credit(
      wallet.id,
      parseFloat(record.amount),
      TransactionCategory.TOPUP,
      record.reference,
      'Wallet top-up',
    );
  }

  async listSavedCards(userId: string): Promise<SavedCard[]> {
    return this.savedCardsRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  async setDefaultCard(userId: string, cardId: string): Promise<SavedCard> {
    const card = await this.savedCardsRepo.findOne({
      where: { id: cardId, userId },
    });
    if (!card) throw new NotFoundException('Saved card not found');

    await this.savedCardsRepo.update({ userId }, { isDefault: false });
    card.isDefault = true;
    return this.savedCardsRepo.save(card);
  }

  async removeCard(
    userId: string,
    cardId: string,
  ): Promise<{ removed: boolean }> {
    const result = await this.savedCardsRepo.delete({ id: cardId, userId });
    return { removed: (result.affected ?? 0) > 0 };
  }

  async getDefaultCard(userId: string): Promise<SavedCard | null> {
    return this.savedCardsRepo.findOne({ where: { userId, isDefault: true } });
  }

  // ---------------------------------------------------------------------
  // Ride settlement
  // ---------------------------------------------------------------------

  /**
   * Charges the passenger's default saved card for a completed ride.
   * Synchronous — Paystack's charge_authorization call returns success/fail
   * immediately, no webhook wait needed (unlike a fresh hosted checkout).
   * Falls back to a clearly-flagged simulated success if Paystack isn't
   * configured, so the rest of the ride flow stays testable without real keys.
   */
  async chargeSavedCard(
    rideId: string,
    userId: string,
    email: string,
    amount: number,
  ): Promise<PaymentRecord> {
    const reference = `ride-card-${randomUUID()}`;

    if (!this.paystack.isConfigured()) {
      return this.paymentsRepo.save(
        this.paymentsRepo.create({
          rideId,
          userId,
          method: PaymentMethod.CARD,
          amount: amount.toFixed(2),
          status: PaymentStatus.SUCCESS,
          reference,
          simulated: true,
          gatewayReference: `SIM-${randomUUID()}`,
        }),
      );
    }

    const card = await this.getDefaultCard(userId);
    if (!card) {
      throw new BadRequestException(
        'No saved card on file — add a card before requesting a card-paid ride',
      );
    }

    const record = await this.paymentsRepo.save(
      this.paymentsRepo.create({
        rideId,
        userId,
        method: PaymentMethod.CARD,
        amount: amount.toFixed(2),
        status: PaymentStatus.PENDING,
        reference,
      }),
    );

    try {
      const result = await this.chargeWithRetry({
        email,
        amountKobo: Math.round(amount * 100),
        authorizationCode: card.authorizationCode,
        reference,
        metadata: { rideId, purpose: 'ride_payment' },
      });

      record.status =
        result.status === 'success'
          ? PaymentStatus.SUCCESS
          : PaymentStatus.FAILED;
      record.gatewayReference = result.reference;
      if (record.status === PaymentStatus.FAILED) {
        // A genuine decline from Paystack, not a network error — retrying
        // wouldn't change the outcome, so this isn't retried.
        record.failureReason = 'Paystack declined the charge';
      }
    } catch (err) {
      // Exhausted retries on a transient (network/timeout) failure.
      record.status = PaymentStatus.FAILED;
      record.failureReason = (err as Error).message;
    }

    return this.paymentsRepo.save(record);
  }

  /**
   * Retries ONLY on a thrown exception (network/timeout — PaystackService's
   * request() throws InternalServerErrorException for those), not on a
   * successful-but-declined response. A decline is a real answer from the
   * gateway; retrying it wastes time and won't change anything. 3 attempts,
   * short exponential backoff — this runs inline within the synchronous
   * charge call, not on a queue, since the whole point is to absorb a
   * flaky-network blip before the caller (ride completion) ever sees it.
   */
  private async chargeWithRetry(
    params: Parameters<PaystackService['chargeAuthorization']>[0],
    maxAttempts = 3,
  ): ReturnType<PaystackService['chargeAuthorization']> {
    let lastError: Error | undefined;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await this.paystack.chargeAuthorization(params);
      } catch (err) {
        lastError = err as Error;
        if (attempt < maxAttempts) {
          await new Promise((resolve) =>
            setTimeout(resolve, 300 * 2 ** (attempt - 1)),
          );
        }
      }
    }
    throw lastError;
  }

  /**
   * Bank transfer settles asynchronously: a dedicated virtual account
   * number is issued for this ride, the passenger transfers into it, and a
   * webhook (charge.success) later confirms payment — see
   * RidesService/PaymentsController for how driver earnings wait for that
   * confirmation instead of crediting immediately.
   */
  async initBankTransfer(
    rideId: string,
    userId: string,
    email: string,
    amount: number,
  ): Promise<ChargeResult> {
    const reference = `ride-bank-${randomUUID()}`;

    if (!this.paystack.isConfigured()) {
      const record = await this.paymentsRepo.save(
        this.paymentsRepo.create({
          rideId,
          userId,
          method: PaymentMethod.BANK_TRANSFER,
          amount: amount.toFixed(2),
          status: PaymentStatus.SUCCESS,
          reference,
          simulated: true,
          gatewayReference: `SIM-${randomUUID()}`,
        }),
      );
      return { record };
    }

    const record = await this.paymentsRepo.save(
      this.paymentsRepo.create({
        rideId,
        userId,
        method: PaymentMethod.BANK_TRANSFER,
        amount: amount.toFixed(2),
        status: PaymentStatus.PENDING,
        reference,
      }),
    );

    const init = await this.paystack.initializeTransaction({
      email,
      amountKobo: Math.round(amount * 100),
      reference,
      channels: ['bank_transfer'],
      metadata: { rideId, purpose: 'ride_payment' },
    });

    // The webhook (charge.success for this reference) is what later
    // confirms payment — see RidesService, which defers crediting driver
    // earnings for bank_transfer until that confirmation lands.
    return { record, authorizationUrl: init.authorizationUrl };
  }

  // ---------------------------------------------------------------------
  // Refunds
  // ---------------------------------------------------------------------

  /**
   * Refund integrity, end to end:
   *
   *  1. RESERVE (short transaction, row-locked): validate the request and
   *     move `amount` into `pendingRefundAmount` — this is what makes a
   *     second refund request fail cleanly ("already in progress") instead
   *     of racing the first, and what caps total refunds at the original
   *     payment amount even across concurrent requests.
   *  2. CALL Paystack — deliberately *outside* the lock, so a slow network
   *     call never holds a row lock on this payment.
   *  3. RESOLVE: most Paystack refunds come back `pending`/`queued` from
   *     the initial call and only actually complete when Paystack later
   *     calls the `refund.processed` (or `refund.failed`) webhook — see
   *     `finalizeRefund()`, which both this method and that webhook call
   *     into. A refund that fails outright, or that Paystack confirms
   *     synchronously, is resolved immediately instead of waiting on a
   *     webhook that may never distinguish itself from "still pending".
   */
  async refundPayment(
    paymentId: string,
    amount?: number,
  ): Promise<PaymentRecord> {
    const { record, refundReference, requested } = await this.reserveRefund(
      paymentId,
      amount,
    );

    let result: { status: string };
    try {
      result = await this.paystack.refund({
        transactionReference: record.reference,
        amountKobo: Math.round(requested * 100),
      });
    } catch (err) {
      // Paystack rejected/never got the request — release the reservation
      // so the amount is refundable again, then surface the real error.
      await this.finalizeRefund(refundReference, false, requested);
      throw err;
    }

    const TERMINAL_SUCCESS = ['success', 'processed', 'reversed'];
    const TERMINAL_FAILURE = ['failed', 'declined', 'reversed_failed'];

    if (TERMINAL_SUCCESS.includes(result.status)) {
      await this.finalizeRefund(refundReference, true, requested);
    } else if (TERMINAL_FAILURE.includes(result.status)) {
      await this.finalizeRefund(refundReference, false, requested);
      throw new ConflictException(
        `Paystack could not process this refund (status: ${result.status})`,
      );
    }
    // Anything else (pending/queued, the common case for real refunds)
    // is left reserved — finalizeRefund() runs again when the
    // refund.processed/refund.failed webhook arrives.

    return this.paymentsRepo.findOneOrFail({ where: { id: paymentId } });
  }

  /** Step 1 of refundPayment() — see the block comment there. */
  private async reserveRefund(
    paymentId: string,
    amount?: number,
  ): Promise<{
    record: PaymentRecord;
    refundReference: string;
    requested: number;
  }> {
    return this.paymentsRepo.manager.transaction(async (manager) => {
      const record = await manager.findOne(PaymentRecord, {
        where: { id: paymentId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!record) throw new NotFoundException('Payment record not found');
      if (
        record.status !== PaymentStatus.SUCCESS &&
        record.status !== PaymentStatus.PARTIALLY_REFUNDED
      ) {
        throw new BadRequestException(
          'Only a successfully settled payment can be refunded',
        );
      }
      if (record.simulated) {
        throw new ConflictException(
          'Cannot refund a simulated (dev-mode) payment',
        );
      }

      const alreadyPending = parseFloat(record.pendingRefundAmount ?? '0');
      if (alreadyPending > 0) {
        throw new ConflictException(
          'A refund for this payment is already in progress — wait for it to be confirmed before requesting another.',
        );
      }

      const total = parseFloat(record.amount);
      const alreadyRefunded = parseFloat(record.refundedAmount ?? '0');
      const remaining = total - alreadyRefunded;
      const requested = amount ?? remaining;

      if (requested <= 0) {
        throw new BadRequestException('Nothing left to refund on this payment');
      }
      // Cent-level rounding tolerance, not a loophole for real overage.
      if (requested > remaining + 0.01) {
        throw new BadRequestException(
          `Refund of ${requested.toFixed(2)} exceeds the remaining refundable amount of ${remaining.toFixed(2)}`,
        );
      }

      record.pendingRefundAmount = requested.toFixed(2);
      const saved = await manager.save(record);
      return { record: saved, refundReference: saved.reference, requested };
    });
  }

  /**
   * Step 3 of refundPayment(), and the handler for Paystack's
   * refund.processed/refund.failed webhooks. Idempotent: if there's
   * nothing reserved for this reference (already finalized, or a stray/
   * duplicate webhook), it's a no-op rather than double-applying a refund.
   */
  private async finalizeRefund(
    reference: string,
    succeeded: boolean,
    expectedAmount?: number,
  ): Promise<void> {
    await this.paymentsRepo.manager.transaction(async (manager) => {
      const record = await manager.findOne(PaymentRecord, {
        where: { reference },
        lock: { mode: 'pessimistic_write' },
      });
      if (!record) return;

      const pending = parseFloat(record.pendingRefundAmount ?? '0');
      if (pending <= 0) return; // nothing in flight — already resolved

      const amount = expectedAmount ?? pending;

      if (succeeded) {
        const newRefunded = parseFloat(record.refundedAmount ?? '0') + amount;
        record.refundedAmount = newRefunded.toFixed(2);
        record.status =
          newRefunded >= parseFloat(record.amount) - 0.01
            ? PaymentStatus.REFUNDED
            : PaymentStatus.PARTIALLY_REFUNDED;
      } else {
        record.failureReason = 'Paystack reported the refund as failed';
      }
      record.pendingRefundAmount = null;
      await manager.save(record);
    });
  }

  /** Called from the webhook controller on refund.processed/refund.failed. */
  async handleRefundWebhook(
    transactionReference: string,
    succeeded: boolean,
  ): Promise<void> {
    await this.finalizeRefund(transactionReference, succeeded);
  }

  // ---------------------------------------------------------------------
  // Webhook support
  // ---------------------------------------------------------------------

  async findByReference(reference: string): Promise<PaymentRecord | null> {
    return this.paymentsRepo.findOne({ where: { reference } });
  }

  /**
   * Idempotent: Paystack retries webhook delivery on any non-2xx response,
   * and duplicate delivery of the same event is documented, expected
   * behaviour on their end (not just a theoretical edge case). Without a
   * guard here, a replayed `charge.success` would re-run every side effect
   * below a second time — most dangerously, crediting a wallet top-up
   * twice for one payment.
   *
   * The transition is done under a row lock so two near-simultaneous
   * deliveries of the same event can't both observe PENDING and both
   * "win" the transition. `alreadyProcessed: true` tells the caller this
   * was a replay — every side effect (wallet credit, event emission,
   * card tokenization) must be skipped in that case.
   */
  /**
   * Marks a payment settled from Paystack's `charge.success` webhook, and —
   * when `purpose === 'wallet_topup'` — credits the wallet in the SAME
   * database transaction as that status flip, not as a separate step
   * afterward.
   *
   * That used to be two transactions: this one flipped the payment to
   * SUCCESS, and the controller called creditWalletFromTopUp() as a
   * separate follow-up step once this one returned. If the process
   * crashed, the wallet service was briefly down, or that second call
   * simply threw, the payment was left permanently marked SUCCESS with
   * the wallet never credited — real money charged by Paystack, gone
   * from the passenger's perspective. Worse, it was unrecoverable:
   * Paystack retries a webhook that didn't 200, but the retry's first
   * step is this method, which would see status already SUCCESS and
   * return `alreadyProcessed: true` — so the controller would skip
   * crediting again on every subsequent retry, forever.
   *
   * Doing both in one transaction means the two outcomes are now
   * genuinely coupled: if crediting throws, the whole transaction rolls
   * back, the payment's status reverts to whatever it was before (not
   * SUCCESS), and Paystack's retry actually gets another real attempt at
   * both instead of silently losing the credit.
   */
  async markSuccessFromWebhook(
    reference: string,
    gatewayReference: string,
    purpose?: string,
  ): Promise<{ record: PaymentRecord; alreadyProcessed: boolean; creditedWalletId?: string } | null> {
    const result = await this.paymentsRepo.manager.transaction(
      async (manager) => {
        const record = await manager.findOne(PaymentRecord, {
          where: { reference },
          lock: { mode: 'pessimistic_write' },
        });
        if (!record) return null;

        if (record.status === PaymentStatus.SUCCESS) {
          return { record, alreadyProcessed: true as const };
        }

        record.status = PaymentStatus.SUCCESS;
        record.gatewayReference = gatewayReference;
        const saved = await manager.save(record);

        let creditedWalletId: string | undefined;
        if (purpose === 'wallet_topup') {
          creditedWalletId = await this.creditWalletFromTopUpWithManager(manager, saved);
        }

        return { record: saved, alreadyProcessed: false as const, creditedWalletId };
      },
    );

    if (result && !result.alreadyProcessed && result.record.rideId) {
      this.events.emit('payment.confirmed', {
        rideId: result.record.rideId,
        paymentRecordId: result.record.id,
      });
    }

    // wallet.updated fires here rather than inside creditWithManager()
    // itself, on purpose — it should only go out once this outer
    // transaction has actually committed, not from inside it (see
    // WalletsService.creditWithManager()'s comment). NOTE: the
    // walletTransactionsTotal Prometheus counter that credit() normally
    // increments alongside this event is NOT incremented on this path —
    // PaymentsService doesn't have MetricsService wired in, and adding
    // it wasn't worth the extra module coupling just for this counter.
    // A wallet-topup-via-webhook credit is real and correct either way;
    // it just won't show up in that particular metric.
    if (result && !result.alreadyProcessed && purpose === 'wallet_topup') {
      this.events.emit('wallet.updated', {
        walletId: result.creditedWalletId,
        userId: result.record.userId,
        direction: 'credit',
        amount: parseFloat(result.record.amount),
        category: TransactionCategory.TOPUP,
      });
    }

    return result;
  }

  /** The atomic-with-the-status-flip half of markSuccessFromWebhook() above. */
  private async creditWalletFromTopUpWithManager(
    manager: EntityManager,
    record: PaymentRecord,
  ): Promise<string> {
    const wallet = await this.walletsService.getByUserId(record.userId);
    await this.walletsService.creditWithManager(
      manager,
      wallet.id,
      parseFloat(record.amount),
      TransactionCategory.TOPUP,
      record.reference,
      'Wallet top-up',
    );
    return wallet.id;
  }

  async markFailedFromWebhook(
    reference: string,
    reason: string,
  ): Promise<PaymentRecord | null> {
    const record = await this.findByReference(reference);
    if (!record) return null;
    record.status = PaymentStatus.FAILED;
    record.failureReason = reason;
    return this.paymentsRepo.save(record);
  }

  async saveCardFromVerification(
    userId: string,
    authorizationCode: string,
    last4: string | null,
    cardType: string | null,
    bank: string | null,
  ): Promise<SavedCard> {
    const existing = await this.savedCardsRepo.findOne({
      where: { authorizationCode },
    });
    if (existing) return existing;

    const hasAnyCard = await this.savedCardsRepo.count({ where: { userId } });
    const card = this.savedCardsRepo.create({
      userId,
      authorizationCode,
      last4,
      cardType,
      bank,
      isDefault: hasAnyCard === 0,
    });
    return this.savedCardsRepo.save(card);
  }

  // ---------------------------------------------------------------------
  // Lookups
  // ---------------------------------------------------------------------

  async findByRide(rideId: string): Promise<PaymentRecord[]> {
    return this.paymentsRepo.find({
      where: { rideId },
      order: { createdAt: 'DESC' },
    });
  }

  async findForUser(userId: string, limit = 50): Promise<PaymentRecord[]> {
    return this.paymentsRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  /**
   * Same "bare list, no name, no filtering" gap already found and fixed
   * for rides/drivers/support/users/incidents/documents/vehicles — no
   * one on the finance side could see failed payments, filter by
   * status, or look anyone up by name before this. PaymentRecord.userId
   * is a plain @Column() with no relation annotation, so the ::text
   * cast is needed here (unlike DriverProfile.userId, which turned out
   * to be a real uuid because of its @JoinColumn relation).
   */
  async findAll(
    filter?: {
      status?: PaymentStatus;
      method?: PaymentMethod;
      search?: string;
    },
    page = 1,
    limit = 25,
  ) {
    const qb = this.paymentsRepo
      .createQueryBuilder('payment')
      .leftJoin(User, 'payer', 'payer.id::text = payment.userId')
      .select('payment.id', 'id')
      .addSelect('payment.rideId', 'rideId')
      .addSelect('payment.method', 'method')
      .addSelect('payment.amount', 'amount')
      .addSelect('payment.status', 'status')
      .addSelect('payment.reference', 'reference')
      .addSelect('payment.simulated', 'simulated')
      .addSelect('payment.failureReason', 'failureReason')
      .addSelect('payment.refundedAmount', 'refundedAmount')
      .addSelect('payment.createdAt', 'createdAt')
      .addSelect('payer.firstName', 'payerFirstName')
      .addSelect('payer.lastName', 'payerLastName')
      .addSelect('payer.phone', 'payerPhone')
      .orderBy('payment.createdAt', 'DESC');

    if (filter?.status)
      qb.andWhere('payment.status = :status', { status: filter.status });
    if (filter?.method)
      qb.andWhere('payment.method = :method', { method: filter.method });
    if (filter?.search) {
      qb.andWhere(
        '(payer."firstName" ILIKE :search OR payer."lastName" ILIKE :search OR payer.phone ILIKE :search OR payment.reference ILIKE :search)',
        { search: `%${filter.search}%` },
      );
    }

    const total = await qb.getCount();
    const items = await qb
      .offset((page - 1) * limit)
      .limit(limit)
      .getRawMany();

    return { items, total, page, limit };
  }
}