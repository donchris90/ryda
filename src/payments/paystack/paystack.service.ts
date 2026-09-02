import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';

export interface PaystackInitializeResult {
  authorizationUrl: string;
  accessCode: string;
  reference: string;
}

export interface PaystackVerifyResult {
  status: 'success' | 'failed' | 'abandoned' | string;
  reference: string;
  amountKobo: number;
  currency: string;
  paidAt: string | null;
  channel: string | null;
  authorization: {
    authorizationCode: string | null;
    last4: string | null;
    cardType: string | null;
    bank: string | null;
    reusable: boolean;
  } | null;
  customerEmail: string | null;
  raw: unknown;
}

export interface PaystackRefundResult {
  status: string;
  reference: string;
  amountKobo: number;
  raw: unknown;
}

export interface PaystackTransferRecipientResult {
  recipientCode: string;
  raw: unknown;
}

export interface PaystackTransferResult {
  status: string;
  transferCode: string;
  reference: string;
  raw: unknown;
}

export interface PaystackTransactionSummary {
  reference: string;
  status: string;
  amountKobo: number;
  paidAt: Date | null;
}

/**
 * Thin client over Paystack's REST API (https://paystack.com/docs/api/).
 * Reads PAYSTACK_SECRET_KEY from config — if it's unset, every call throws
 * clearly rather than silently no-opping, so a missing key fails loudly in
 * whichever environment forgot to set it (dev/staging can still simulate at
 * the PaymentsService layer, which checks isConfigured() first).
 */
@Injectable()
export class PaystackService {
  private readonly logger = new Logger(PaystackService.name);
  private readonly secretKey: string;
  private readonly baseUrl: string;

  constructor(private readonly config: ConfigService) {
    this.secretKey = this.config.get<string>('paystack.secretKey') ?? '';
    this.baseUrl = this.config.get<string>('paystack.baseUrl')!;

    if (this.secretKey.startsWith('sk_live_')) {
      this.logger.warn(
        'Paystack is configured with a LIVE secret key — real charges will occur.',
      );
    }
  }

  isConfigured(): boolean {
    return this.secretKey.length > 0;
  }

  /** Starts a hosted-checkout transaction (used to tokenize a card the first time). */
  async initializeTransaction(params: {
    email: string;
    amountKobo: number;
    reference: string;
    callbackUrl?: string;
    metadata?: Record<string, unknown>;
    channels?: string[];
  }): Promise<PaystackInitializeResult> {
    const body: Record<string, unknown> = {
      email: params.email,
      amount: params.amountKobo,
      reference: params.reference,
      metadata: params.metadata,
    };
    if (params.callbackUrl) body.callback_url = params.callbackUrl;
    if (params.channels) body.channels = params.channels;

    const data = await this.request('POST', '/transaction/initialize', body);
    return {
      authorizationUrl: data.authorization_url,
      accessCode: data.access_code,
      reference: data.reference,
    };
  }

  /** Confirms a transaction's final status — always trust this over client-side callbacks. */
  async verifyTransaction(reference: string): Promise<PaystackVerifyResult> {
    const data = await this.request('GET', `/transaction/verify/${encodeURIComponent(reference)}`);
    return this.mapVerifyResponse(data);
  }

  /**
   * Charges a previously-saved card (no redirect) — this is the "card on
   * file" flow used to settle a ride synchronously at completion time.
   */
  async chargeAuthorization(params: {
    email: string;
    amountKobo: number;
    authorizationCode: string;
    reference: string;
    metadata?: Record<string, unknown>;
  }): Promise<PaystackVerifyResult> {
    const data = await this.request('POST', '/transaction/charge_authorization', {
      email: params.email,
      amount: params.amountKobo,
      authorization_code: params.authorizationCode,
      reference: params.reference,
      metadata: params.metadata,
    });
    return this.mapVerifyResponse(data);
  }

  async refund(params: { transactionReference: string; amountKobo?: number }): Promise<PaystackRefundResult> {
    const body: Record<string, unknown> = { transaction: params.transactionReference };
    if (params.amountKobo) body.amount = params.amountKobo;

    const data = await this.request('POST', '/refund', body);
    return {
      status: data.status ?? data.transaction?.status ?? 'pending',
      reference: params.transactionReference,
      amountKobo: data.amount ?? params.amountKobo ?? 0,
      raw: data,
    };
  }

  /**
   * Verifies an account number actually belongs to a real account at the
   * given bank, returning the bank's own record of the account holder's
   * name — used before ever creating a transfer recipient, so a driver
   * can't (accidentally or otherwise) register a withdrawal destination
   * under a name that doesn't match the real account.
   */
  async resolveAccountNumber(accountNumber: string, bankCode: string): Promise<{ accountName: string }> {
    const data = await this.request('GET', `/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`);
    return { accountName: data.account_name };
  }

  /** Registers a driver's bank account as a payout recipient — required once before transfers. */
  async createTransferRecipient(params: {
    name: string;
    accountNumber: string;
    bankCode: string;
    currency?: string;
  }): Promise<PaystackTransferRecipientResult> {
    const data = await this.request('POST', '/transferrecipient', {
      type: 'nuban',
      name: params.name,
      account_number: params.accountNumber,
      bank_code: params.bankCode,
      currency: params.currency ?? 'NGN',
    });
    return { recipientCode: data.recipient_code, raw: data };
  }

  /** Pays out a driver/fleet — moves money OUT of the Paystack balance. */
  async initiateTransfer(params: {
    amountKobo: number;
    recipientCode: string;
    reason?: string;
    reference: string;
  }): Promise<PaystackTransferResult> {
    const data = await this.request('POST', '/transfer', {
      source: 'balance',
      amount: params.amountKobo,
      recipient: params.recipientCode,
      reason: params.reason,
      reference: params.reference,
    });
    return {
      status: data.status,
      transferCode: data.transfer_code,
      reference: params.reference,
      raw: data,
    };
  }

  async listBanks(country = 'nigeria'): Promise<Array<{ name: string; code: string }>> {
    const data = await this.request('GET', `/bank?country=${country}`);
    return (data as any[]).map((b) => ({ name: b.name, code: b.code }));
  }

  /**
   * Lists every transaction Paystack has on record in the given range -
   * used by ReconciliationController's Paystack-side reconciliation to
   * compare against what this backend's own payment_records show.
   * Paginates through everything itself (perPage capped at 100, the
   * documented Paystack maximum) rather than handing back just the
   * first page, since a real reconciliation window can span far more
   * than one page's worth of transactions.
   */
  async listTransactions(from: Date, to: Date): Promise<PaystackTransactionSummary[]> {
    const results: PaystackTransactionSummary[] = [];
    let page = 1;
    const perPage = 100;

    while (true) {
      const query = new URLSearchParams({
        perPage: String(perPage),
        page: String(page),
        from: from.toISOString(),
        to: to.toISOString(),
      });
      const data = await this.request('GET', `/transaction?${query.toString()}`);
      const rows = (data as any[]) ?? [];
      for (const row of rows) {
        results.push({
          reference: row.reference,
          status: row.status,
          amountKobo: row.amount,
          paidAt: row.paid_at ? new Date(row.paid_at) : null,
        });
      }
      if (rows.length < perPage) break; // last page
      page += 1;
    }

    return results;
  }

  /**
   * Verifies the `x-paystack-signature` header on an incoming webhook using
   * HMAC-SHA512 of the raw request body with the secret key, per Paystack's
   * documented webhook security contract. Uses a constant-time comparison.
   */
  verifyWebhookSignature(rawBody: string, signatureHeader: string | undefined): boolean {
    if (!signatureHeader || !this.secretKey) return false;
    const expected = createHmac('sha512', this.secretKey).update(rawBody).digest('hex');
    const expectedBuf = Buffer.from(expected, 'utf8');
    const givenBuf = Buffer.from(signatureHeader, 'utf8');
    if (expectedBuf.length !== givenBuf.length) return false;
    return timingSafeEqual(expectedBuf, givenBuf);
  }

  private mapVerifyResponse(data: any): PaystackVerifyResult {
    return {
      status: data.status,
      reference: data.reference,
      amountKobo: data.amount,
      currency: data.currency,
      paidAt: data.paid_at ?? null,
      channel: data.channel ?? null,
      authorization: data.authorization
        ? {
            authorizationCode: data.authorization.authorization_code ?? null,
            last4: data.authorization.last4 ?? null,
            cardType: data.authorization.card_type ?? null,
            bank: data.authorization.bank ?? null,
            reusable: !!data.authorization.reusable,
          }
        : null,
      customerEmail: data.customer?.email ?? null,
      raw: data,
    };
  }

  private async request(method: 'GET' | 'POST', path: string, body?: unknown): Promise<any> {
    if (!this.secretKey) {
      throw new InternalServerErrorException(
        'PAYSTACK_SECRET_KEY is not configured on this server',
      );
    }

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(10000),
      });
    } catch (err) {
      this.logger.error(`Paystack request failed: ${method} ${path}`, err as Error);
      throw new InternalServerErrorException('Could not reach Paystack');
    }

    const json = await response.json().catch(() => ({}) as any);

    if (!response.ok || json.status === false) {
      this.logger.warn(`Paystack ${method} ${path} responded ${response.status}: ${json.message}`);
      throw new InternalServerErrorException(json.message ?? 'Paystack request failed');
    }

    return json.data;
  }
}
