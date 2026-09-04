import { PaymentsService } from './payments.service';
import { PaymentStatus } from './entities/payment-record.entity';
import { PaymentMethod } from '../common/enums/ride.enum';

function build(overrides: Record<string, any> = {}) {
  const paymentsRepo = {
    findOne: jest.fn().mockResolvedValue(null),
    save: jest.fn(async (r: any) => ({ id: 'payment-1', ...r })),
    create: jest.fn((d: any) => d),
    count: jest.fn().mockResolvedValue(0),
    ...overrides.paymentsRepo,
  };
  const savedCardsRepo = {
    findOne: jest.fn().mockResolvedValue({ id: 'card-1', userId: 'user-1', authorizationCode: 'AUTH_1', isDefault: true }),
    create: jest.fn((d: any) => d),
    save: jest.fn(async (d: any) => ({ id: 'card-new', ...d })),
    count: jest.fn().mockResolvedValue(0),
    ...overrides.savedCardsRepo,
  };
  const paystack = {
    isConfigured: jest.fn().mockReturnValue(true),
    chargeAuthorization: jest.fn().mockResolvedValue({ status: 'success', reference: 'ref-1' }),
    ...overrides.paystack,
  };
  const config = { get: jest.fn().mockReturnValue(100) };
  const events = { emit: jest.fn() };
  const walletsService = {};
  const fraudService = {
    checkPaymentFailurePattern: jest.fn().mockResolvedValue(undefined),
    checkMultipleCardsAdded: jest.fn().mockResolvedValue(undefined),
    checkChargebackHistory: jest.fn().mockResolvedValue(undefined),
    ...overrides.fraudService,
  };
  const disputesRepo = {
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn((d: any) => d),
    save: jest.fn(async (d: any) => ({ id: 'dispute-1', ...d })),
    count: jest.fn().mockResolvedValue(0),
    ...overrides.disputesRepo,
  };

  const service = new PaymentsService(
    paymentsRepo as any,
    savedCardsRepo as any,
    paystack as any,
    config as any,
    events as any,
    walletsService as any,
    fraudService as any,
    disputesRepo as any,
  );

  return { service, paymentsRepo, savedCardsRepo, paystack, fraudService, disputesRepo };
}

describe('PaymentsService.chargeSavedCard() - repeated-failure detection', () => {
  it('checks the fraud pattern (with the recent-failure count) when a charge is declined', async () => {
    const { service, paymentsRepo, fraudService } = build({
      paystack: { isConfigured: jest.fn().mockReturnValue(true), chargeAuthorization: jest.fn().mockResolvedValue({ status: 'failed', reference: 'ref-1' }) },
      paymentsRepo: { count: jest.fn().mockResolvedValue(4) },
    });

    await service.chargeSavedCard('ride-1', 'user-1', 'ada@example.com', 1000);

    expect(fraudService.checkPaymentFailurePattern).toHaveBeenCalledWith('user-1', 4);
  });

  it('never calls the fraud check at all when the charge succeeds', async () => {
    const { service, fraudService } = build();

    await service.chargeSavedCard('ride-1', 'user-1', 'ada@example.com', 1000);

    expect(fraudService.checkPaymentFailurePattern).not.toHaveBeenCalled();
  });

  it('still checks the pattern when the failure came from an exhausted-retry exception, not just a clean decline', async () => {
    const { service, fraudService } = build({
      paystack: { isConfigured: jest.fn().mockReturnValue(true), chargeAuthorization: jest.fn().mockRejectedValue(new Error('network down')) },
      paymentsRepo: { count: jest.fn().mockResolvedValue(3) },
    });

    await service.chargeSavedCard('ride-1', 'user-1', 'ada@example.com', 1000);

    expect(fraudService.checkPaymentFailurePattern).toHaveBeenCalledWith('user-1', 3);
  });

  it('counts only CARD-method failures for this user within the recent window, not every payment ever', async () => {
    const { service, paymentsRepo } = build({
      paystack: { isConfigured: jest.fn().mockReturnValue(true), chargeAuthorization: jest.fn().mockResolvedValue({ status: 'failed', reference: 'ref-1' }) },
    });

    await service.chargeSavedCard('ride-1', 'user-1', 'ada@example.com', 1000);

    expect(paymentsRepo.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: 'user-1', method: PaymentMethod.CARD, status: PaymentStatus.FAILED }) }),
    );
  });

  it('a fraud-check failure never breaks the payment response the caller is waiting on', async () => {
    const { service } = build({
      paystack: { isConfigured: jest.fn().mockReturnValue(true), chargeAuthorization: jest.fn().mockResolvedValue({ status: 'failed', reference: 'ref-1' }) },
      fraudService: { checkPaymentFailurePattern: jest.fn().mockRejectedValue(new Error('fraud service down')) },
    });

    await expect(service.chargeSavedCard('ride-1', 'user-1', 'ada@example.com', 1000)).resolves.toBeDefined();
  });
});

describe('PaymentsService.saveCardFromVerification() - multiple-cards detection', () => {
  it('checks the multiple-cards pattern (with the recent-card count) whenever a new card is saved', async () => {
    const { service, fraudService } = build({
      savedCardsRepo: {
        findOne: jest.fn().mockResolvedValue(null), // no existing card with this authorizationCode
        create: jest.fn((d: any) => d),
        save: jest.fn(async (d: any) => ({ id: 'card-new', ...d })),
        count: jest.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(4), // hasAnyCard check, then recent-window check
      },
    });

    await service.saveCardFromVerification('user-1', 'AUTH_NEW', '4242', 'visa', 'Test Bank');

    expect(fraudService.checkMultipleCardsAdded).toHaveBeenCalledWith('user-1', 4);
  });

  it('does not save a second row (or re-check) for a card already on file under the same authorization code', async () => {
    const existingCard = { id: 'card-existing', userId: 'user-1', authorizationCode: 'AUTH_DUP' };
    const { service, fraudService, savedCardsRepo } = build({
      savedCardsRepo: { findOne: jest.fn().mockResolvedValue(existingCard) },
    });

    const result = await service.saveCardFromVerification('user-1', 'AUTH_DUP', '4242', 'visa', 'Test Bank');

    expect(result).toBe(existingCard);
    expect(savedCardsRepo.save).not.toHaveBeenCalled();
    expect(fraudService.checkMultipleCardsAdded).not.toHaveBeenCalled();
  });
});

describe('PaymentsService.handleDisputeWebhook() - chargeback tracking', () => {
  const disputePayload = (overrides: Record<string, any> = {}) => ({
    id: 12345,
    status: 'awaiting-merchant-feedback',
    amount: 100000, // kobo -> 1000.00
    transaction: { reference: 'ref-1' },
    ...overrides,
  });

  it('creates a new dispute record on charge.dispute.create, resolving the userId from the linked payment', async () => {
    const { service, disputesRepo, paymentsRepo } = build({
      paymentsRepo: { findOne: jest.fn().mockResolvedValue({ id: 'payment-1', reference: 'ref-1', userId: 'user-9' }) },
    });

    await service.handleDisputeWebhook('charge.dispute.create', disputePayload());

    expect(disputesRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ paystackDisputeId: '12345', paymentReference: 'ref-1', userId: 'user-9', amount: '1000.00' }),
    );
  });

  it('updates the SAME row (not a new one) on charge.dispute.remind for a dispute already on file', async () => {
    const existing = { id: 'dispute-1', paystackDisputeId: '12345', paymentReference: 'ref-1', userId: 'user-9', status: 'awaiting-merchant-feedback' };
    const { service, disputesRepo } = build({
      disputesRepo: { findOne: jest.fn().mockResolvedValue(existing) },
    });

    await service.handleDisputeWebhook('charge.dispute.remind', disputePayload({ status: 'awaiting-bank-feedback' }));

    expect(disputesRepo.create).not.toHaveBeenCalled();
    expect(disputesRepo.save).toHaveBeenCalledWith(expect.objectContaining({ id: 'dispute-1', status: 'awaiting-bank-feedback' }));
  });

  it('checks the chargeback-history pattern only on charge.dispute.resolve with status RESOLVED', async () => {
    const existing = { id: 'dispute-1', paystackDisputeId: '12345', paymentReference: 'ref-1', userId: 'user-9', status: 'pending' };
    const { service, fraudService, disputesRepo } = build({
      disputesRepo: { findOne: jest.fn().mockResolvedValue(existing), count: jest.fn().mockResolvedValue(2) },
    });

    await service.handleDisputeWebhook('charge.dispute.resolve', disputePayload({ status: 'resolved', resolution: 'merchant-accepted' }));

    expect(fraudService.checkChargebackHistory).toHaveBeenCalledWith('user-9', 2);
  });

  it('does NOT check the pattern on charge.dispute.create - the dispute is still open, nothing to score yet', async () => {
    const { service, fraudService } = build({
      paymentsRepo: { findOne: jest.fn().mockResolvedValue({ id: 'payment-1', reference: 'ref-1', userId: 'user-9' }) },
    });

    await service.handleDisputeWebhook('charge.dispute.create', disputePayload());

    expect(fraudService.checkChargebackHistory).not.toHaveBeenCalled();
  });

  it('does NOT check the pattern on charge.dispute.remind either - still open', async () => {
    const existing = { id: 'dispute-1', paystackDisputeId: '12345', paymentReference: 'ref-1', userId: 'user-9', status: 'pending' };
    const { service, fraudService } = build({
      disputesRepo: { findOne: jest.fn().mockResolvedValue(existing) },
    });

    await service.handleDisputeWebhook('charge.dispute.remind', disputePayload({ status: 'awaiting-bank-feedback' }));

    expect(fraudService.checkChargebackHistory).not.toHaveBeenCalled();
  });

  it('never crashes (and links no user) when the webhook payload is missing the transaction reference entirely', async () => {
    const { service, disputesRepo } = build();

    await expect(service.handleDisputeWebhook('charge.dispute.create', disputePayload({ transaction: undefined }))).resolves.toBeUndefined();
    expect(disputesRepo.save).not.toHaveBeenCalled();
  });

  it('a fraud-check failure never breaks the webhook response Paystack is waiting on', async () => {
    const existing = { id: 'dispute-1', paystackDisputeId: '12345', paymentReference: 'ref-1', userId: 'user-9', status: 'pending' };
    const { service } = build({
      disputesRepo: { findOne: jest.fn().mockResolvedValue(existing) },
      fraudService: { checkChargebackHistory: jest.fn().mockRejectedValue(new Error('fraud service down')) },
    });

    await expect(
      service.handleDisputeWebhook('charge.dispute.resolve', disputePayload({ status: 'resolved', resolution: 'merchant-accepted' })),
    ).resolves.toBeUndefined();
  });
});
