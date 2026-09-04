import { BadRequestException, ConflictException } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PaymentStatus } from './entities/payment-record.entity';

function build(overrides: { existingPending?: any; paystackConfigured?: boolean; initFails?: boolean } = {}) {
  let savedRecord: any = null;
  const paymentsRepo = {
    findOne: jest.fn().mockResolvedValue(overrides.existingPending ?? null),
    save: jest.fn(async (r: any) => {
      savedRecord = { id: 'payment-1', ...r };
      return savedRecord;
    }),
    create: jest.fn((d: any) => d),
  } as any;
  const savedCardsRepo = {} as any;
  const paystack = {
    isConfigured: jest.fn().mockReturnValue(overrides.paystackConfigured ?? true),
    initializeTransaction: overrides.initFails
      ? jest.fn().mockRejectedValue(new Error('Paystack unreachable'))
      : jest.fn().mockResolvedValue({ authorizationUrl: 'https://paystack.test/checkout' }),
  } as any;
  const config = { get: jest.fn().mockReturnValue(100) } as any;
  const events = { emit: jest.fn() } as any;
  const walletsService = {} as any;

  const service = new PaymentsService(paymentsRepo, savedCardsRepo, paystack, config, events, walletsService, {} as any, {} as any);
  return { service, paymentsRepo, paystack, getSavedRecord: () => savedRecord };
}

describe('PaymentsService.initWalletTopUp() - duplicate-tap guard and failure handling', () => {
  it('rejects a second top-up for the SAME amount within the narrow window - a double-tap/retry signature', async () => {
    const { service, paystack } = build({
      existingPending: { id: 'existing-1', amount: '500.00', status: PaymentStatus.PENDING },
    });

    await expect(service.initWalletTopUp('user-1', 'user@example.com', 500)).rejects.toThrow(ConflictException);
    expect(paystack.initializeTransaction).not.toHaveBeenCalled();
  });

  it('allows a new top-up when there is no recent pending one at all', async () => {
    const { service, paystack } = build({ existingPending: null });

    await expect(service.initWalletTopUp('user-1', 'user@example.com', 500)).resolves.toBeDefined();
    expect(paystack.initializeTransaction).toHaveBeenCalled();
  });

  it('marks the PaymentRecord FAILED (not left orphaned PENDING) when the actual Paystack initialize call fails - a real, separate gap found and fixed alongside the duplicate-tap guard', async () => {
    const { service, getSavedRecord } = build({ existingPending: null, initFails: true });

    await expect(service.initWalletTopUp('user-1', 'user@example.com', 500)).rejects.toThrow('Paystack unreachable');

    expect(getSavedRecord().status).toBe(PaymentStatus.FAILED);
    expect(getSavedRecord().failureReason).toContain('Paystack unreachable');
  });

  it('rejects below the minimum top-up amount before ever checking for a duplicate', async () => {
    const { service, paystack } = build({ existingPending: null });

    await expect(service.initWalletTopUp('user-1', 'user@example.com', 1)).rejects.toThrow(BadRequestException);
    expect(paystack.initializeTransaction).not.toHaveBeenCalled();
  });
});
