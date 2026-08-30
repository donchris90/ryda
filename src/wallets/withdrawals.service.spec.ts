import { WithdrawalsService } from './withdrawals.service';
import { WithdrawalRequest, WithdrawalStatus } from './entities/withdrawal-request.entity';
import { TransactionCategory } from '../common/enums/transaction.enum';

function makeRequest(overrides: Partial<WithdrawalRequest> = {}): WithdrawalRequest {
  return {
    id: 'wd-1',
    userId: 'user-1',
    bankAccountId: 'bank-1',
    amount: '5000.00',
    status: WithdrawalStatus.PROCESSING,
    reference: 'wd_abc123',
    paystackTransferCode: 'trf_xyz',
    failureReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    completedAt: null,
    ...overrides,
  } as WithdrawalRequest;
}

/**
 * Mocks the manager.transaction(...) pessimistic-lock pattern the real
 * service uses, so the fix's row-locked read-then-write can be exercised
 * without a real database. Each call to handleTransferWebhook re-reads
 * whatever the previous call last saved — the same thing a real
 * transaction would see on a second, later delivery.
 */
function makeWithdrawalsRepo(initialRequest: WithdrawalRequest | null) {
  let current = initialRequest ? { ...initialRequest } : null;

  const manager = {
    findOne: jest.fn(async () => (current ? { ...current } : null)),
    save: jest.fn(async (entity: WithdrawalRequest) => {
      current = { ...entity };
      return current;
    }),
  };

  const withdrawalsRepo = {
    manager: { transaction: jest.fn((cb: (m: typeof manager) => unknown) => cb(manager)) },
  } as any;

  return { withdrawalsRepo, getCurrent: () => current };
}

function makeWalletsService() {
  return {
    getByUserId: jest.fn(async (userId: string) => ({ id: `wallet-${userId}`, userId })),
    credit: jest.fn(async () => undefined),
    debit: jest.fn(async () => undefined),
  } as any;
}

function makeEventEmitter() {
  return { emit: jest.fn() } as any;
}

describe('WithdrawalsService.handleTransferWebhook', () => {
  it('marks the request completed and emits withdrawal.completed on transfer.success', async () => {
    const { withdrawalsRepo, getCurrent } = makeWithdrawalsRepo(makeRequest());
    const walletsService = makeWalletsService();
    const events = makeEventEmitter();
    const service = new WithdrawalsService(
      {} as any,
      withdrawalsRepo,
      walletsService,
      {} as any,
      {} as any,
      events,
    );

    await service.handleTransferWebhook('wd_abc123', true);

    expect(getCurrent()?.status).toBe(WithdrawalStatus.COMPLETED);
    expect(walletsService.credit).not.toHaveBeenCalled();
    expect(events.emit).toHaveBeenCalledWith(
      'withdrawal.completed',
      expect.objectContaining({ userId: 'user-1' }),
    );
  });

  it('refunds the wallet, marks the request failed, and emits withdrawal.failed on transfer.failed', async () => {
    const { withdrawalsRepo, getCurrent } = makeWithdrawalsRepo(makeRequest());
    const walletsService = makeWalletsService();
    const events = makeEventEmitter();
    const service = new WithdrawalsService(
      {} as any,
      withdrawalsRepo,
      walletsService,
      {} as any,
      {} as any,
      events,
    );

    await service.handleTransferWebhook('wd_abc123', false, 'Insufficient funds in payout account');

    expect(getCurrent()?.status).toBe(WithdrawalStatus.FAILED);
    expect(getCurrent()?.failureReason).toBe('Insufficient funds in payout account');
    expect(walletsService.credit).toHaveBeenCalledWith(
      'wallet-user-1',
      5000,
      TransactionCategory.WITHDRAWAL,
      'wd_abc123',
      expect.any(String),
    );
    expect(events.emit).toHaveBeenCalledWith(
      'withdrawal.failed',
      expect.objectContaining({ userId: 'user-1' }),
    );
  });

  /**
   * Regression test: Paystack documents webhook retries and duplicate
   * delivery as expected behaviour. A second delivery of the same event
   * (or a stray transfer.failed after transfer.success already settled
   * it) must be a no-op — never a second wallet credit or a second
   * status transition.
   */
  it('is a no-op on a replayed webhook once the request is no longer PROCESSING', async () => {
    const { withdrawalsRepo, getCurrent } = makeWithdrawalsRepo(
      makeRequest({ status: WithdrawalStatus.FAILED, failureReason: 'Already handled' }),
    );
    const walletsService = makeWalletsService();
    const events = makeEventEmitter();
    const service = new WithdrawalsService(
      {} as any,
      withdrawalsRepo,
      walletsService,
      {} as any,
      {} as any,
      events,
    );

    await service.handleTransferWebhook('wd_abc123', false, 'transfer.failed retried by Paystack');

    expect(getCurrent()?.status).toBe(WithdrawalStatus.FAILED);
    expect(getCurrent()?.failureReason).toBe('Already handled'); // untouched — not overwritten by the replay
    expect(walletsService.credit).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('is a no-op when the reference does not match any known withdrawal request', async () => {
    const { withdrawalsRepo } = makeWithdrawalsRepo(null);
    const walletsService = makeWalletsService();
    const events = makeEventEmitter();
    const service = new WithdrawalsService(
      {} as any,
      withdrawalsRepo,
      walletsService,
      {} as any,
      {} as any,
      events,
    );

    await service.handleTransferWebhook('wd_does_not_exist', true);

    expect(walletsService.credit).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });
});
