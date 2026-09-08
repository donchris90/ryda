import { WalletsService } from './wallets.service';
import { TransactionCategory } from '../common/enums/transaction.enum';
import { TransactionDirection } from '../common/enums/transaction.enum';

function fakeTx(overrides: Record<string, any> = {}) {
  return {
    id: 'tx-1',
    walletId: 'wallet-1',
    direction: TransactionDirection.CREDIT,
    category: TransactionCategory.RIDE_EARNING,
    amount: '2500.00',
    balanceAfter: '10000.00',
    referenceId: null,
    description: null,
    createdAt: new Date('2026-06-01T10:00:00.000Z'),
    ...overrides,
  };
}

function build(overrides: Record<string, any> = {}) {
  const walletsRepo = {
    findOne: jest.fn().mockResolvedValue({ id: 'wallet-1', userId: 'user-1', balance: '10000.00' }),
    manager: {},
  };
  const txRepo = {
    find: jest.fn().mockResolvedValue([fakeTx()]),
    ...overrides.txRepo,
  };
  const settingsService = { getNumber: jest.fn() };
  const events = { emit: jest.fn() };
  const metrics = {};

  const service = new WalletsService(walletsRepo as any, txRepo as any, settingsService as any, events as any, metrics as any);
  return { service, walletsRepo, txRepo };
}

describe('WalletsService.generateStatementCsv()', () => {
  it('produces a header row plus one row per transaction', async () => {
    const { service } = build();
    const csv = await service.generateStatementCsv('user-1');
    const lines = csv.split('\n');
    expect(lines[0]).toBe('Date,Direction,Category,Amount,Balance after,Reference,Description');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('2500.00');
    expect(lines[1]).toContain('10000.00');
  });

  it('escapes a description containing a comma so it stays one CSV field', async () => {
    const { service } = build({
      txRepo: { find: jest.fn().mockResolvedValue([fakeTx({ description: 'Ride from Ikeja, Lagos' })]) },
    });
    const csv = await service.generateStatementCsv('user-1');
    expect(csv).toContain('"Ride from Ikeja, Lagos"');
  });

  it('escapes a description containing a quote by doubling it', async () => {
    const { service } = build({
      txRepo: { find: jest.fn().mockResolvedValue([fakeTx({ description: 'Driver said "thanks"' })]) },
    });
    const csv = await service.generateStatementCsv('user-1');
    expect(csv).toContain('"Driver said ""thanks"""');
  });

  it('passes the from/to range through to the transaction query', async () => {
    const { service, txRepo } = build();
    const from = new Date('2026-01-01');
    const to = new Date('2026-02-01');

    await service.generateStatementCsv('user-1', from, to);

    expect(txRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ walletId: 'wallet-1' }) }),
    );
  });

  it('produces just the header row when there are no transactions in range', async () => {
    const { service } = build({ txRepo: { find: jest.fn().mockResolvedValue([]) } });
    const csv = await service.generateStatementCsv('user-1');
    expect(csv.split('\n')).toHaveLength(1);
  });
});
