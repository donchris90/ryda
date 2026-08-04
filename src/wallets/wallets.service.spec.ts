import { WalletsService } from './wallets.service';
import { TransactionCategory } from '../common/enums/transaction.enum';
import { Wallet } from './entities/wallet.entity';
import { WalletTransaction } from './entities/wallet-transaction.entity';

function makeWallet(overrides: Partial<Wallet> = {}): Wallet {
  return {
    id: 'wallet-1',
    userId: 'user-1',
    balance: '1000.00',
    currency: 'NGN',
    isFrozen: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Wallet;
}

/** Mocks the manager.transaction(...) pattern the real service uses for atomic credit/debit. */
function makeWalletsRepo(initialWallet: Wallet) {
  let currentWallet = { ...initialWallet };

  const manager = {
    findOne: jest.fn(async (_entity: unknown, _opts: unknown) => ({ ...currentWallet })),
    save: jest.fn(async (entityOrClass: unknown, maybeData?: unknown) => {
      // save(wallet) — the entity itself — vs save(WalletTransaction, {...}) — entity class + data.
      if (maybeData === undefined && (entityOrClass as any)?.id) {
        currentWallet = { ...(entityOrClass as Wallet) };
        return currentWallet;
      }
      return maybeData;
    }),
  };

  const walletsRepo = {
    manager: { transaction: jest.fn((cb: (m: typeof manager) => unknown) => cb(manager)) },
  } as any;

  return { walletsRepo, getCurrentWallet: () => currentWallet };
}

function makeTxRepo() {
  return {} as any;
}

function makeSettingsService(maxBalance?: number) {
  return {
    getNumber: jest.fn(async (_key: string, fallback: number) => maxBalance ?? fallback),
  } as any;
}

function makeEventEmitter() {
  return { emit: jest.fn() } as any;
}

function makeMetricsService() {
  return { walletTransactionsTotal: { inc: jest.fn() } } as any;
}

describe('WalletsService', () => {
  it('credits the correct amount and returns the updated balance', async () => {
    const { walletsRepo, getCurrentWallet } = makeWalletsRepo(makeWallet({ balance: '1000.00' }));
    const service = new WalletsService(walletsRepo, makeTxRepo(), makeSettingsService(), makeEventEmitter(), makeMetricsService());

    const result = await service.credit('wallet-1', 500, TransactionCategory.RIDE_EARNING);

    expect(result.balance).toBe('1500.00');
    expect(getCurrentWallet().balance).toBe('1500.00');
  });

  it('debits the correct amount when sufficient balance exists', async () => {
    const { walletsRepo } = makeWalletsRepo(makeWallet({ balance: '1000.00' }));
    const service = new WalletsService(walletsRepo, makeTxRepo(), makeSettingsService(), makeEventEmitter(), makeMetricsService());

    const result = await service.debit('wallet-1', 300, TransactionCategory.RIDE_PAYMENT);

    expect(result.balance).toBe('700.00');
  });

  it('rejects a debit larger than the current balance', async () => {
    const { walletsRepo } = makeWalletsRepo(makeWallet({ balance: '100.00' }));
    const service = new WalletsService(walletsRepo, makeTxRepo(), makeSettingsService(), makeEventEmitter(), makeMetricsService());

    await expect(service.debit('wallet-1', 500, TransactionCategory.RIDE_PAYMENT)).rejects.toThrow(
      /insufficient/i,
    );
  });

  it('rejects a debit from a frozen wallet', async () => {
    const { walletsRepo } = makeWalletsRepo(makeWallet({ balance: '1000.00', isFrozen: true }));
    const service = new WalletsService(walletsRepo, makeTxRepo(), makeSettingsService(), makeEventEmitter(), makeMetricsService());

    await expect(service.debit('wallet-1', 100, TransactionCategory.RIDE_PAYMENT)).rejects.toThrow(
      /frozen/i,
    );
  });

  it('rejects a zero or negative amount for both credit and debit', async () => {
    const { walletsRepo } = makeWalletsRepo(makeWallet());
    const service = new WalletsService(walletsRepo, makeTxRepo(), makeSettingsService(), makeEventEmitter(), makeMetricsService());

    await expect(service.credit('wallet-1', 0, TransactionCategory.RIDE_EARNING)).rejects.toThrow(
      /positive/i,
    );
    await expect(service.debit('wallet-1', -50, TransactionCategory.RIDE_PAYMENT)).rejects.toThrow(
      /positive/i,
    );
  });

  it('enforces the max-balance limit on TOPUP credits', async () => {
    const { walletsRepo } = makeWalletsRepo(makeWallet({ balance: '1800.00' }));
    const service = new WalletsService(walletsRepo, makeTxRepo(), makeSettingsService(2000), makeEventEmitter(), makeMetricsService());

    await expect(service.credit('wallet-1', 500, TransactionCategory.TOPUP)).rejects.toThrow(
      /maximum wallet balance/i,
    );
  });

  it('does NOT enforce the max-balance limit on ride-earning credits — a driver must still get paid', async () => {
    const { walletsRepo } = makeWalletsRepo(makeWallet({ balance: '1800.00' }));
    const service = new WalletsService(walletsRepo, makeTxRepo(), makeSettingsService(2000), makeEventEmitter(), makeMetricsService());

    // Same amount that was rejected for TOPUP in the previous test — should
    // succeed here since the limit is scoped to top-ups only.
    const result = await service.credit('wallet-1', 500, TransactionCategory.RIDE_EARNING);

    expect(result.balance).toBe('2300.00');
  });

  it('emits a wallet.updated event with the correct direction on credit and debit', async () => {
    const events = makeEventEmitter();
    const { walletsRepo } = makeWalletsRepo(makeWallet({ balance: '1000.00' }));
    const service = new WalletsService(walletsRepo, makeTxRepo(), makeSettingsService(), events, makeMetricsService());

    await service.credit('wallet-1', 100, TransactionCategory.RIDE_EARNING);
    expect(events.emit).toHaveBeenCalledWith('wallet.updated', expect.objectContaining({ direction: 'credit' }));

    await service.debit('wallet-1', 50, TransactionCategory.RIDE_PAYMENT);
    expect(events.emit).toHaveBeenCalledWith('wallet.updated', expect.objectContaining({ direction: 'debit' }));
  });
});
