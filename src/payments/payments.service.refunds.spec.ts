import { BadRequestException, ConflictException } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PaymentRecord, PaymentStatus } from './entities/payment-record.entity';
import { PaymentMethod } from '../common/enums/ride.enum';

function fakeRecord(overrides: Partial<PaymentRecord> = {}): PaymentRecord {
  return {
    id: 'payment-1',
    rideId: 'ride-1',
    userId: 'user-1',
    method: PaymentMethod.CARD,
    amount: '1000.00',
    status: PaymentStatus.SUCCESS,
    reference: 'ref-1',
    simulated: false,
    gatewayReference: 'GW-1',
    failureReason: null,
    refundedAmount: null,
    pendingRefundAmount: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as PaymentRecord;
}

/**
 * Same stateful-manager pattern as wallets.service.spec.ts's
 * makeWalletsRepo() - tracks the "current" record across the
 * manager.transaction(...) callback so reserveRefund() and
 * finalizeRefund() (two separate transactions, exactly like the real
 * service) see each other's effects, the way they genuinely do in
 * production.
 */
function makePaymentsRepo(initialRecord: PaymentRecord) {
  let current = { ...initialRecord };

  const manager = {
    findOne: jest.fn(async (_entity: unknown, opts: any) => {
      // reserveRefund() looks up by id, finalizeRefund() by reference -
      // both need to resolve to the same underlying record here.
      if (opts?.where?.id && opts.where.id !== current.id) return null;
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
    findOneOrFail: jest.fn(async () => ({ ...current })),
    count: jest.fn().mockResolvedValue(0),
  } as any;

  return { paymentsRepo, getCurrentRecord: () => current };
}

function build(initialRecord: PaymentRecord, overrides: { paystack?: any; fraudService?: any; paymentsRepoOverrides?: any } = {}) {
  const { paymentsRepo, getCurrentRecord } = makePaymentsRepo(initialRecord);
  if (overrides.paymentsRepoOverrides) Object.assign(paymentsRepo, overrides.paymentsRepoOverrides);
  const savedCardsRepo = {} as any;
  const paystack = { refund: jest.fn(), ...overrides.paystack };
  const config = { get: jest.fn() } as any;
  const events = { emit: jest.fn() } as any;
  const walletsService = {} as any;

  const fraudService = { checkExcessiveRefunds: jest.fn().mockResolvedValue(undefined), ...overrides.fraudService };
  const service = new PaymentsService(paymentsRepo, savedCardsRepo, paystack as any, config, events, walletsService, fraudService, {} as any);
  return { service, paymentsRepo, paystack, events, fraudService, getCurrentRecord };
}

describe('PaymentsService refunds', () => {
  describe('refundPayment()', () => {
    it('full refund: no amount specified, Paystack confirms synchronously - status becomes REFUNDED, pendingRefundAmount cleared', async () => {
      const { service, paystack, getCurrentRecord } = build(fakeRecord({ amount: '1000.00' }));
      paystack.refund.mockResolvedValue({ status: 'success' });

      const result = await service.refundPayment('payment-1');

      expect(paystack.refund).toHaveBeenCalledWith({ transactionReference: 'ref-1', amountKobo: 100000 });
      expect(getCurrentRecord().status).toBe(PaymentStatus.REFUNDED);
      expect(getCurrentRecord().refundedAmount).toBe('1000.00');
      expect(getCurrentRecord().pendingRefundAmount).toBeNull();
      expect(result.status).toBe(PaymentStatus.REFUNDED);
    });

    it('partial refund: specific amount less than total - status becomes PARTIALLY_REFUNDED, not REFUNDED', async () => {
      const { service, paystack, getCurrentRecord } = build(fakeRecord({ amount: '1000.00' }));
      paystack.refund.mockResolvedValue({ status: 'success' });

      await service.refundPayment('payment-1', 300);

      expect(paystack.refund).toHaveBeenCalledWith({ transactionReference: 'ref-1', amountKobo: 30000 });
      expect(getCurrentRecord().status).toBe(PaymentStatus.PARTIALLY_REFUNDED);
      expect(getCurrentRecord().refundedAmount).toBe('300.00');
    });

    it('checks the excessive-refunds pattern (with the recent-refund count) once a refund genuinely succeeds', async () => {
      const { service, paystack, fraudService } = build(fakeRecord({ amount: '1000.00', userId: 'user-7' }), {
        paymentsRepoOverrides: { count: jest.fn().mockResolvedValue(4) },
      });
      paystack.refund.mockResolvedValue({ status: 'success' });

      await service.refundPayment('payment-1');

      expect(fraudService.checkExcessiveRefunds).toHaveBeenCalledWith('user-7', 4);
    });

    it('never checks the pattern when Paystack reports the refund as failed', async () => {
      const { service, paystack, fraudService } = build(fakeRecord({ amount: '1000.00' }));
      paystack.refund.mockResolvedValue({ status: 'failed' });

      await expect(service.refundPayment('payment-1')).rejects.toThrow(ConflictException);
      expect(fraudService.checkExcessiveRefunds).not.toHaveBeenCalled();
    });

    it('a second partial refund on top of an already-partially-refunded payment correctly targets only the remaining amount, and can complete the refund', async () => {
      const { service, paystack, getCurrentRecord } = build(
        fakeRecord({ amount: '1000.00', status: PaymentStatus.PARTIALLY_REFUNDED, refundedAmount: '300.00' }),
      );
      paystack.refund.mockResolvedValue({ status: 'success' });

      // No amount specified -> should refund exactly the remaining 700, not the full original 1000.
      await service.refundPayment('payment-1');

      expect(paystack.refund).toHaveBeenCalledWith({ transactionReference: 'ref-1', amountKobo: 70000 });
      expect(getCurrentRecord().status).toBe(PaymentStatus.REFUNDED);
      expect(getCurrentRecord().refundedAmount).toBe('1000.00');
    });

    it('rejects a refund amount exceeding the remaining refundable amount', async () => {
      const { service, paystack } = build(fakeRecord({ amount: '1000.00', refundedAmount: '600.00' }));

      await expect(service.refundPayment('payment-1', 500)).rejects.toThrow(BadRequestException);
      expect(paystack.refund).not.toHaveBeenCalled();
    });

    it('rejects a second refund request while one is already pending - the concurrent/duplicate-refund case Batch 4 explicitly asks about', async () => {
      const { service, paystack } = build(fakeRecord({ amount: '1000.00', pendingRefundAmount: '400.00' }));

      await expect(service.refundPayment('payment-1', 200)).rejects.toThrow(ConflictException);
      expect(paystack.refund).not.toHaveBeenCalled();
    });

    it('rejects refunding a simulated (dev-mode) payment', async () => {
      const { service, paystack } = build(fakeRecord({ simulated: true }));

      await expect(service.refundPayment('payment-1')).rejects.toThrow(ConflictException);
      expect(paystack.refund).not.toHaveBeenCalled();
    });

    it('rejects refunding a payment that never succeeded', async () => {
      const { service, paystack } = build(fakeRecord({ status: PaymentStatus.FAILED }));

      await expect(service.refundPayment('payment-1')).rejects.toThrow(BadRequestException);
      expect(paystack.refund).not.toHaveBeenCalled();
    });

    it('rejects when there is nothing left to refund on an otherwise-still-eligible (PARTIALLY_REFUNDED) payment', async () => {
      const { service, paystack } = build(
        fakeRecord({ amount: '1000.00', refundedAmount: '1000.00', status: PaymentStatus.PARTIALLY_REFUNDED }),
      );

      await expect(service.refundPayment('payment-1')).rejects.toThrow('Nothing left to refund');
      expect(paystack.refund).not.toHaveBeenCalled();
    });

    it('Paystack returning pending/queued (the common real-world case) leaves the reservation in place rather than finalizing early', async () => {
      const { service, paystack, getCurrentRecord } = build(fakeRecord({ amount: '1000.00' }));
      paystack.refund.mockResolvedValue({ status: 'pending' });

      await service.refundPayment('payment-1');

      // Still SUCCESS, not yet REFUNDED - genuinely waiting on the webhook.
      expect(getCurrentRecord().status).toBe(PaymentStatus.SUCCESS);
      expect(getCurrentRecord().pendingRefundAmount).toBe('1000.00');
    });

    it('Paystack rejecting the refund outright (terminal failure) releases the reservation and throws, rather than leaving money stuck reserved', async () => {
      const { service, paystack, getCurrentRecord } = build(fakeRecord({ amount: '1000.00' }));
      paystack.refund.mockResolvedValue({ status: 'failed' });

      await expect(service.refundPayment('payment-1')).rejects.toThrow(ConflictException);
      expect(getCurrentRecord().pendingRefundAmount).toBeNull();
      expect(getCurrentRecord().status).toBe(PaymentStatus.SUCCESS); // never actually refunded
    });

    it('Paystack throwing (network/API error) releases the reservation so a retry is possible, and surfaces the real error', async () => {
      const { service, paystack, getCurrentRecord } = build(fakeRecord({ amount: '1000.00' }));
      paystack.refund.mockRejectedValue(new Error('Paystack timeout'));

      await expect(service.refundPayment('payment-1')).rejects.toThrow('Paystack timeout');
      expect(getCurrentRecord().pendingRefundAmount).toBeNull();
    });
  });

  describe('handleRefundWebhook() - confirms an in-flight refund, called from the refund.processed/refund.failed webhook', () => {
    it('confirms success: finalizes the pending refund as REFUNDED', async () => {
      const { service, getCurrentRecord } = build(
        fakeRecord({ amount: '1000.00', pendingRefundAmount: '1000.00' }),
      );

      await service.handleRefundWebhook('ref-1', true);

      expect(getCurrentRecord().status).toBe(PaymentStatus.REFUNDED);
      expect(getCurrentRecord().refundedAmount).toBe('1000.00');
      expect(getCurrentRecord().pendingRefundAmount).toBeNull();
    });

    it('confirms failure: releases the reservation without crediting a refund', async () => {
      const { service, getCurrentRecord } = build(
        fakeRecord({ amount: '1000.00', pendingRefundAmount: '1000.00' }),
      );

      await service.handleRefundWebhook('ref-1', false);

      expect(getCurrentRecord().status).toBe(PaymentStatus.SUCCESS);
      expect(getCurrentRecord().refundedAmount).toBeNull();
      expect(getCurrentRecord().pendingRefundAmount).toBeNull();
      expect(getCurrentRecord().failureReason).toContain('failed');
    });

    it('is idempotent: a duplicate/stray webhook with nothing actually pending is a no-op, not a double-applied refund', async () => {
      const { service, getCurrentRecord } = build(
        fakeRecord({ amount: '1000.00', status: PaymentStatus.REFUNDED, refundedAmount: '1000.00', pendingRefundAmount: null }),
      );

      await service.handleRefundWebhook('ref-1', true);

      // Completely unchanged - nothing was pending, so nothing happened.
      expect(getCurrentRecord().refundedAmount).toBe('1000.00');
      expect(getCurrentRecord().status).toBe(PaymentStatus.REFUNDED);
    });

    it('a webhook for an unknown reference is a safe no-op, not an error', async () => {
      const { service } = build(fakeRecord({ reference: 'ref-1' }));

      await expect(service.handleRefundWebhook('some-other-reference', true)).resolves.toBeUndefined();
    });
  });
});
