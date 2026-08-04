import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { PaymentRecord, PaymentStatus } from './entities/payment-record.entity';
import { SavedCard } from './entities/saved-card.entity';
import { PaymentMethod } from '../common/enums/ride.enum';
import { PaystackService } from './paystack/paystack.service';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
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
  async initCardAdd(userId: string, email: string): Promise<{ authorizationUrl: string; reference: string }> {
    if (!this.paystack.isConfigured()) {
      throw new BadRequestException(
        'Card payments are not available — PAYSTACK_SECRET_KEY is not configured on this server',
      );
    }
    const amountKobo = this.config.get<number>('paystack.cardVerificationKobo')!;
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
    });

    return { authorizationUrl: init.authorizationUrl, reference };
  }

  async listSavedCards(userId: string): Promise<SavedCard[]> {
    return this.savedCardsRepo.find({ where: { userId }, order: { createdAt: 'DESC' } });
  }

  async setDefaultCard(userId: string, cardId: string): Promise<SavedCard> {
    const card = await this.savedCardsRepo.findOne({ where: { id: cardId, userId } });
    if (!card) throw new NotFoundException('Saved card not found');

    await this.savedCardsRepo.update({ userId }, { isDefault: false });
    card.isDefault = true;
    return this.savedCardsRepo.save(card);
  }

  async removeCard(userId: string, cardId: string): Promise<{ removed: boolean }> {
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

      record.status = result.status === 'success' ? PaymentStatus.SUCCESS : PaymentStatus.FAILED;
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
          await new Promise((resolve) => setTimeout(resolve, 300 * 2 ** (attempt - 1)));
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

  async refundPayment(paymentId: string, amount?: number): Promise<PaymentRecord> {
    const record = await this.paymentsRepo.findOne({ where: { id: paymentId } });
    if (!record) throw new NotFoundException('Payment record not found');
    if (record.status !== PaymentStatus.SUCCESS) {
      throw new BadRequestException('Only a successfully settled payment can be refunded');
    }
    if (record.simulated) {
      throw new ConflictException('Cannot refund a simulated (dev-mode) payment');
    }

    const amountKobo = amount ? Math.round(amount * 100) : undefined;
    const result = await this.paystack.refund({
      transactionReference: record.reference,
      amountKobo,
    });

    const refundedSoFar = parseFloat(record.refundedAmount ?? '0') + (amount ?? parseFloat(record.amount));
    record.refundedAmount = refundedSoFar.toFixed(2);
    record.status =
      refundedSoFar >= parseFloat(record.amount)
        ? PaymentStatus.REFUNDED
        : PaymentStatus.PARTIALLY_REFUNDED;

    void result;
    return this.paymentsRepo.save(record);
  }

  // ---------------------------------------------------------------------
  // Webhook support
  // ---------------------------------------------------------------------

  async findByReference(reference: string): Promise<PaymentRecord | null> {
    return this.paymentsRepo.findOne({ where: { reference } });
  }

  async markSuccessFromWebhook(reference: string, gatewayReference: string): Promise<PaymentRecord | null> {
    const record = await this.findByReference(reference);
    if (!record) return null;
    record.status = PaymentStatus.SUCCESS;
    record.gatewayReference = gatewayReference;
    const saved = await this.paymentsRepo.save(record);

    if (saved.rideId) {
      this.events.emit('payment.confirmed', { rideId: saved.rideId, paymentRecordId: saved.id });
    }
    return saved;
  }

  async markFailedFromWebhook(reference: string, reason: string): Promise<PaymentRecord | null> {
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
    const existing = await this.savedCardsRepo.findOne({ where: { authorizationCode } });
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
    return this.paymentsRepo.find({ where: { rideId }, order: { createdAt: 'DESC' } });
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
  async findAll(filter?: { status?: PaymentStatus; method?: PaymentMethod; search?: string }, page = 1, limit = 25) {
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

    if (filter?.status) qb.andWhere('payment.status = :status', { status: filter.status });
    if (filter?.method) qb.andWhere('payment.method = :method', { method: filter.method });
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
