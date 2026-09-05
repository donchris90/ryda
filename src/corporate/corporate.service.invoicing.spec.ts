import { ConflictException, NotFoundException } from '@nestjs/common';
import { CorporateService } from './corporate.service';
import { TransactionDirection } from '../common/enums/transaction.enum';

function buildService(overrides: Record<string, any> = {}) {
  const accountsRepo = {
    findOne: jest.fn().mockResolvedValue({ id: 'account-1', currency: 'NGN', isActive: true }),
    find: jest.fn().mockResolvedValue([]),
    ...overrides.accountsRepo,
  };
  const invoicesRepo = {
    findOne: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockResolvedValue([]),
    create: jest.fn((d: any) => d),
    save: jest.fn(async (d: any) => ({ id: 'invoice-1', ...d })),
    ...overrides.invoicesRepo,
  };
  const txRepo = {
    createQueryBuilder: jest.fn(),
    find: jest.fn().mockResolvedValue([]),
    ...overrides.txRepo,
  };

  const service = new CorporateService(
    accountsRepo as any,
    {} as any,
    txRepo as any,
    {} as any,
    {} as any,
    invoicesRepo as any,
    {} as any,
  );
  return { service, accountsRepo, invoicesRepo, txRepo };
}

/** A chainable query-builder stub, single-use (each call to createQueryBuilder gets a fresh one from the queue). */
function fakeQueryBuilder({ getOne, getRawMany }: { getOne?: any; getRawMany?: any[] }) {
  return {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue(getOne ?? null),
    getRawMany: jest.fn().mockResolvedValue(getRawMany ?? []),
  };
}

const periodStart = new Date('2026-02-01T00:00:00Z');
const periodEnd = new Date('2026-03-01T00:00:00Z');

describe('CorporateService.generateInvoiceForPeriod()', () => {
  it('returns the already-generated invoice for this exact period without recomputing anything', async () => {
    const existing = { id: 'invoice-existing', corporateAccountId: 'account-1', periodStart, periodEnd };
    const { service, txRepo } = buildService({
      invoicesRepo: { findOne: jest.fn().mockResolvedValue(existing) },
    });

    const result = await service.generateInvoiceForPeriod('account-1', periodStart, periodEnd);

    expect(result).toBe(existing);
    expect(txRepo.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('throws NotFoundException for an account that does not exist', async () => {
    const { service } = buildService({ accountsRepo: { findOne: jest.fn().mockResolvedValue(null) } });

    await expect(service.generateInvoiceForPeriod('missing', periodStart, periodEnd)).rejects.toThrow(NotFoundException);
  });

  it('computes opening balance from the last transaction before the period, closing balance from the last one before period end, and correct debit/credit totals', async () => {
    const queues = [
      fakeQueryBuilder({ getOne: { balanceAfter: '10000.00' } }), // opening balance query
      fakeQueryBuilder({ getOne: { balanceAfter: '7500.00' } }), // closing balance query
      fakeQueryBuilder({
        getRawMany: [
          { direction: TransactionDirection.DEBIT, count: '3', total: '4500.00' },
          { direction: TransactionDirection.CREDIT, count: '1', total: '2000.00' },
        ],
      }), // totals query
    ];
    let call = 0;
    const { service, invoicesRepo } = buildService({
      txRepo: { createQueryBuilder: jest.fn(() => queues[call++]) },
    });

    await service.generateInvoiceForPeriod('account-1', periodStart, periodEnd);

    expect(invoicesRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        corporateAccountId: 'account-1',
        openingBalance: '10000.00',
        closingBalance: '7500.00',
        totalDebits: '4500.00',
        totalCredits: '2000.00',
        transactionCount: 4,
        currency: 'NGN',
      }),
    );
  });

  it("defaults opening balance to '0.00' for a brand-new account with no transaction history before the period at all", async () => {
    const queues = [
      fakeQueryBuilder({ getOne: null }), // no prior transaction at all
      fakeQueryBuilder({ getOne: { balanceAfter: '1000.00' } }),
      fakeQueryBuilder({ getRawMany: [{ direction: TransactionDirection.CREDIT, count: '1', total: '1000.00' }] }),
    ];
    let call = 0;
    const { service, invoicesRepo } = buildService({
      txRepo: { createQueryBuilder: jest.fn(() => queues[call++]) },
    });

    await service.generateInvoiceForPeriod('account-1', periodStart, periodEnd);

    expect(invoicesRepo.save).toHaveBeenCalledWith(expect.objectContaining({ openingBalance: '0.00' }));
  });

  it('produces a valid statement for a quiet period with zero transactions - opening and closing balance are identical, totals are zero', async () => {
    const queues = [
      fakeQueryBuilder({ getOne: { balanceAfter: '5000.00' } }),
      fakeQueryBuilder({ getOne: { balanceAfter: '5000.00' } }),
      fakeQueryBuilder({ getRawMany: [] }),
    ];
    let call = 0;
    const { service, invoicesRepo } = buildService({
      txRepo: { createQueryBuilder: jest.fn(() => queues[call++]) },
    });

    await service.generateInvoiceForPeriod('account-1', periodStart, periodEnd);

    expect(invoicesRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        openingBalance: '5000.00',
        closingBalance: '5000.00',
        totalDebits: '0.00',
        totalCredits: '0.00',
        transactionCount: 0,
      }),
    );
  });

  it('resolves to the winning row instead of throwing when a concurrent generation attempt already inserted this exact period first', async () => {
    const queues = [
      fakeQueryBuilder({ getOne: { balanceAfter: '1000.00' } }),
      fakeQueryBuilder({ getOne: { balanceAfter: '1000.00' } }),
      fakeQueryBuilder({ getRawMany: [] }),
    ];
    let call = 0;
    const winner = { id: 'invoice-winner', corporateAccountId: 'account-1', periodStart, periodEnd };
    const { service } = buildService({
      txRepo: { createQueryBuilder: jest.fn(() => queues[call++]) },
      invoicesRepo: {
        // First call (idempotency check): nothing yet. Second call
        // (after the losing save() throws): the other request's row.
        findOne: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(winner),
        save: jest.fn().mockRejectedValue(new Error('duplicate key value violates unique constraint')),
      },
    });

    const result = await service.generateInvoiceForPeriod('account-1', periodStart, periodEnd);

    expect(result).toBe(winner);
  });

  it('surfaces a real ConflictException if the save fails for a reason that turns out NOT to be a race (no winning row actually exists)', async () => {
    const queues = [
      fakeQueryBuilder({ getOne: null }),
      fakeQueryBuilder({ getOne: null }),
      fakeQueryBuilder({ getRawMany: [] }),
    ];
    let call = 0;
    const { service } = buildService({
      txRepo: { createQueryBuilder: jest.fn(() => queues[call++]) },
      invoicesRepo: {
        findOne: jest.fn().mockResolvedValue(null),
        save: jest.fn().mockRejectedValue(new Error('some other database error')),
      },
    });

    await expect(service.generateInvoiceForPeriod('account-1', periodStart, periodEnd)).rejects.toThrow(ConflictException);
  });
});

describe('CorporateService.generateMonthlyInvoices() - the monthly cron', () => {
  it('generates the previous calendar month for every active account, and skips inactive ones entirely', async () => {
    const { service, accountsRepo } = buildService({
      accountsRepo: {
        find: jest.fn().mockResolvedValue([{ id: 'account-a' }, { id: 'account-b' }]),
      },
    });
    const spy = jest.spyOn(service, 'generateInvoiceForPeriod').mockResolvedValue({} as any);

    await service.generateMonthlyInvoices();

    expect(accountsRepo.find).toHaveBeenCalledWith({ where: { isActive: true } });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenCalledWith('account-a', expect.any(Date), expect.any(Date));
    expect(spy).toHaveBeenCalledWith('account-b', expect.any(Date), expect.any(Date));

    // Both accounts get the exact same period - the previous calendar
    // month, not something computed per-account.
    const [, startA, endA] = spy.mock.calls[0];
    const [, startB, endB] = spy.mock.calls[1];
    expect(startA.getTime()).toBe(startB.getTime());
    expect(endA.getTime()).toBe(endB.getTime());
    // The period is exactly one calendar month wide.
    expect(endA.getUTCMonth()).toBe((startA.getUTCMonth() + 1) % 12);
  });

  it('does nothing (no invoices attempted) when there are no active accounts at all', async () => {
    const { service } = buildService({ accountsRepo: { find: jest.fn().mockResolvedValue([]) } });
    const spy = jest.spyOn(service, 'generateInvoiceForPeriod').mockResolvedValue({} as any);

    await service.generateMonthlyInvoices();

    expect(spy).not.toHaveBeenCalled();
  });
});

describe('CorporateService.listInvoices()', () => {
  it("returns this account's invoices, most recent period first", async () => {
    const { service, invoicesRepo } = buildService();

    await service.listInvoices('account-1');

    expect(invoicesRepo.find).toHaveBeenCalledWith({
      where: { corporateAccountId: 'account-1' },
      order: { periodStart: 'DESC' },
    });
  });
});

describe('CorporateService.getInvoiceDetail()', () => {
  it('returns the invoice together with only the transactions that actually fall inside its period', async () => {
    const invoice = { id: 'invoice-1', corporateAccountId: 'account-1', periodStart, periodEnd };
    const inPeriod = { id: 'tx-1', createdAt: new Date('2026-02-15T00:00:00Z') };
    const beforePeriod = { id: 'tx-0', createdAt: new Date('2026-01-15T00:00:00Z') };
    const afterPeriod = { id: 'tx-2', createdAt: new Date('2026-03-15T00:00:00Z') };
    const { service } = buildService({
      invoicesRepo: { findOne: jest.fn().mockResolvedValue(invoice) },
      txRepo: { find: jest.fn().mockResolvedValue([beforePeriod, inPeriod, afterPeriod]) },
    });

    const result = await service.getInvoiceDetail('account-1', 'invoice-1');

    expect(result.invoice).toBe(invoice);
    expect(result.lineItems).toEqual([inPeriod]);
  });

  it('throws NotFoundException for an invoice ID that belongs to a DIFFERENT corporate account - never leaks another company statement', async () => {
    const { service } = buildService({
      // The query is scoped by (id AND corporateAccountId) together -
      // simulate that scoping actually finding nothing for this account.
      invoicesRepo: { findOne: jest.fn().mockResolvedValue(null) },
    });

    await expect(service.getInvoiceDetail('account-1', 'someone-elses-invoice')).rejects.toThrow(NotFoundException);
  });

  it("scopes the lookup by BOTH invoice id and the caller's own account id, not id alone", async () => {
    const { service, invoicesRepo } = buildService({
      invoicesRepo: { findOne: jest.fn().mockResolvedValue({ id: 'invoice-1', corporateAccountId: 'account-1', periodStart, periodEnd }) },
    });

    await service.getInvoiceDetail('account-1', 'invoice-1');

    expect(invoicesRepo.findOne).toHaveBeenCalledWith({ where: { id: 'invoice-1', corporateAccountId: 'account-1' } });
  });
});
