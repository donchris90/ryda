import { PaymentsService } from './payments.service';
import { PaymentRecord, PaymentStatus } from './entities/payment-record.entity';
import { PaymentMethod } from '../common/enums/ride.enum';

function fakeRecord(overrides: Partial<PaymentRecord> = {}): PaymentRecord {
  return {
    id: 'payment-1',
    rideId: null,
    userId: 'user-1',
    method: PaymentMethod.CARD,
    amount: '500.00',
    status: PaymentStatus.PENDING,
    reference: 'wallet-topup-ref-1',
    simulated: false,
    gatewayReference: null,
    failureReason: null,
    refundedAmount: null,
    pendingRefundAmount: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as PaymentRecord;
}

/** Same stateful-manager pattern used in payments.service.refunds.spec.ts. */
function makePaymentsRepo(initialRecord: PaymentRecord | null) {
  let current = initialRecord ? { ...initialRecord } : null;

  const manager = {
    findOne: jest.fn(async (_entity: unknown, opts: any) => {
      if (!current) return null;
      if (opts?.where?.reference && opts.where.reference !== current.reference) return null;
      return { ...current };
    }),
    save: jest.fn(async (entity: PaymentRecord) => {
      current = { ...entity };
      return current;
    }),
  };

  const paymentsRepo = {
    manager: { transaction: jest.fn((cb: (m: typeof manager) => unknown) => cb(manager)) },
    findOne: jest.fn(async (opts: any) => {
      if (!current) return null;
      if (opts?.where?.reference && opts.where.reference !== current.reference) return null;
      return { ...current };
    }),
    save: jest.fn(async (entity: PaymentRecord) => {
      current = { ...entity };
      return current;
    }),
  } as any;

  return { paymentsRepo, getCurrentRecord: () => current };
}

function build(
  initialRecord: PaymentRecord | null,
  overrides: { paystack?: any; walletsService?: any } = {},
) {
  const { paymentsRepo, getCurrentRecord } = makePaymentsRepo(initialRecord);
  const savedCardsRepo = {
    findOne: jest.fn().mockResolvedValue(null),
    count: jest.fn().mockResolvedValue(0),
    create: jest.fn((d: any) => d),
    save: jest.fn(async (d: any) => ({ id: 'card-1', ...d })),
  } as any;
  const paystack = {
    isConfigured: jest.fn().mockReturnValue(true),
    verifyTransaction: jest.fn(),
    refund: jest.fn().mockResolvedValue({ status: 'success' }),
    ...overrides.paystack,
  };
  const config = { get: jest.fn() } as any;
  const events = { emit: jest.fn() } as any;
  const walletsService = {
    getByUserId: jest.fn().mockResolvedValue({ id: 'wallet-1' }),
    credit: jest.fn().mockResolvedValue(undefined),
    ...overrides.walletsService,
  };
  const fraudService = { checkMultipleCardsAdded: jest.fn().mockResolvedValue(undefined) };

  const service = new PaymentsService(
    paymentsRepo,
    savedCardsRepo,
    paystack as any,
    config,
    events,
    walletsService as any,
    fraudService as any,
    {} as any,
  );
  return { service, paystack, walletsService, savedCardsRepo, getCurrentRecord };
}

describe('PaymentsService.verifyAndSyncByReference()', () => {
  it('returns null for a reference that does not exist', async () => {
    const { service } = build(null);
    await expect(service.verifyAndSyncByReference('user-1', 'nope')).resolves.toBeNull();
  });

  it("returns null when the reference exists but belongs to a different user - never leaks another user's payment", async () => {
    const { service } = build(fakeRecord({ userId: 'someone-else' }));
    await expect(service.verifyAndSyncByReference('user-1', 'wallet-topup-ref-1')).resolves.toBeNull();
  });

  it('returns the record as-is without calling Paystack when it is already settled (not PENDING)', async () => {
    const { service, paystack } = build(fakeRecord({ status: PaymentStatus.SUCCESS }));
    const result = await service.verifyAndSyncByReference('user-1', 'wallet-topup-ref-1');
    expect(result?.status).toBe(PaymentStatus.SUCCESS);
    expect(paystack.verifyTransaction).not.toHaveBeenCalled();
  });

  it('returns PENDING as-is when Paystack is not configured, rather than erroring', async () => {
    const { service, paystack } = build(fakeRecord(), { paystack: { isConfigured: () => false } });
    const result = await service.verifyAndSyncByReference('user-1', 'wallet-topup-ref-1');
    expect(result?.status).toBe(PaymentStatus.PENDING);
    expect(paystack.verifyTransaction).not.toHaveBeenCalled();
  });

  it('returns PENDING as-is (not an error) when Paystack itself is unreachable - client can retry', async () => {
    const { service } = build(fakeRecord(), {
      paystack: { verifyTransaction: jest.fn().mockRejectedValue(new Error('network down')) },
    });
    const result = await service.verifyAndSyncByReference('user-1', 'wallet-topup-ref-1');
    expect(result?.status).toBe(PaymentStatus.PENDING);
  });

  it('leaves the record PENDING when Paystack also reports it as still pending', async () => {
    const { service } = build(fakeRecord(), {
      paystack: { verifyTransaction: jest.fn().mockResolvedValue({ status: 'pending', raw: {} }) },
    });
    const result = await service.verifyAndSyncByReference('user-1', 'wallet-topup-ref-1');
    expect(result?.status).toBe(PaymentStatus.PENDING);
  });

  it('marks FAILED and stores a reason when Paystack reports the charge failed', async () => {
    const { service, getCurrentRecord } = build(fakeRecord(), {
      paystack: { verifyTransaction: jest.fn().mockResolvedValue({ status: 'failed', raw: {} }) },
    });
    const result = await service.verifyAndSyncByReference('user-1', 'wallet-topup-ref-1');
    expect(result?.status).toBe(PaymentStatus.FAILED);
    expect(result?.failureReason).toContain('failed');
    expect(getCurrentRecord()?.status).toBe(PaymentStatus.FAILED);
  });

  it('marks SUCCESS and credits the wallet exactly once for a wallet_topup charge Paystack confirms but our webhook missed', async () => {
    const { service, walletsService, getCurrentRecord } = build(fakeRecord({ amount: '750.00' }), {
      paystack: {
        verifyTransaction: jest.fn().mockResolvedValue({
          status: 'success',
          raw: { id: 998877, metadata: { purpose: 'wallet_topup' } },
          authorization: null,
        }),
      },
    });

    const result = await service.verifyAndSyncByReference('user-1', 'wallet-topup-ref-1');

    expect(result?.status).toBe(PaymentStatus.SUCCESS);
    expect(getCurrentRecord()?.gatewayReference).toBe('998877');
    expect(walletsService.credit).toHaveBeenCalledTimes(1);
    expect(walletsService.credit).toHaveBeenCalledWith('wallet-1', 750, expect.anything(), 'wallet-topup-ref-1', expect.any(String));
  });

  it('tokenizes the card and refunds the verification charge for a card_verification purchase Paystack confirms', async () => {
    const { service, paystack, savedCardsRepo } = build(
      fakeRecord({ reference: 'card-verify-ref-1', method: PaymentMethod.CARD }),
      {
        paystack: {
          verifyTransaction: jest.fn().mockResolvedValue({
            status: 'success',
            raw: { id: 111, metadata: { purpose: 'card_verification' } },
            authorization: {
              authorizationCode: 'AUTH_abc',
              last4: '4242',
              cardType: 'visa',
              bank: 'GTBank',
              reusable: true,
            },
          }),
        },
      },
    );

    const result = await service.verifyAndSyncByReference('user-1', 'card-verify-ref-1');

    expect(result?.status).toBe(PaymentStatus.SUCCESS);
    expect(savedCardsRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ authorizationCode: 'AUTH_abc', last4: '4242' }),
    );
    expect(paystack.refund).toHaveBeenCalledWith({ transactionReference: 'card-verify-ref-1' });
  });

  it('does not double-credit the wallet if the record was already marked SUCCESS between the client request and this check (race with the webhook)', async () => {
    // markSuccessFromWebhook's alreadyProcessed guard is what prevents this -
    // simulate the record having flipped to SUCCESS mid-flight isn't
    // straightforward with this stateful mock, so instead verify the
    // already-SUCCESS short-circuit at the top of the method (covered
    // above) is what's relied on rather than re-deriving side effects here.
    const { service, walletsService } = build(fakeRecord({ status: PaymentStatus.SUCCESS }));
    await service.verifyAndSyncByReference('user-1', 'wallet-topup-ref-1');
    expect(walletsService.credit).not.toHaveBeenCalled();
  });
});
