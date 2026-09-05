import { ReconciliationService } from './reconciliation.service';
import { ReconciliationStatus } from './entities/cash-reconciliation.entity';

/**
 * getSummary() drives the admin Reconciliation page's four summary cards
 * (Outstanding / Drivers owing / Settled to date / Written off) - this was
 * previously missing entirely (the frontend called a `/summary` endpoint
 * that had no backend route or service method behind it at all). Covers:
 *  - each status bucket totals correctly and independently of the others
 *  - a status with zero rows still returns 0/'0.00', not undefined/NaN
 *  - driversWithPendingDebt counts DISTINCT drivers, not pending rows
 */
describe('ReconciliationService.getSummary', () => {
  function buildQueryBuilder(groupedRows: Array<{ status: string; count: string; total: string }>, driversWithPendingDebt: string) {
    const groupedQb: any = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue(groupedRows),
    };
    const driversQb: any = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ driversWithPendingDebt }),
    };

    // The service calls createQueryBuilder twice: once for the grouped
    // status totals, once for the distinct-driver count. Return a fresh
    // builder each call, matching real TypeORM repository behaviour.
    const repo: any = {
      createQueryBuilder: jest
        .fn()
        .mockReturnValueOnce(groupedQb)
        .mockReturnValueOnce(driversQb),
    };
    return repo;
  }

  function build(repo: any) {
    return new ReconciliationService(repo, {} as any, {} as any, {} as any);
  }

  it('maps each status bucket to the correct summary field', async () => {
    const repo = buildQueryBuilder(
      [
        { status: ReconciliationStatus.PENDING, count: '3', total: '1500.00' },
        { status: ReconciliationStatus.SETTLED, count: '10', total: '42000.50' },
        { status: ReconciliationStatus.WRITTEN_OFF, count: '2', total: '900.00' },
      ],
      '2',
    );
    const service = build(repo);

    const summary = await service.getSummary();

    expect(summary).toEqual({
      pendingCount: 3,
      pendingTotal: '1500.00',
      settledCount: 10,
      settledTotal: '42000.50',
      writtenOffCount: 2,
      writtenOffTotal: '900.00',
      driversWithPendingDebt: 2,
    });
  });

  it('returns zeroed fields for a status with no rows, rather than NaN/undefined', async () => {
    // Only PENDING has rows — SETTLED and WRITTEN_OFF never occurred yet.
    const repo = buildQueryBuilder(
      [{ status: ReconciliationStatus.PENDING, count: '1', total: '250.00' }],
      '1',
    );
    const service = build(repo);

    const summary = await service.getSummary();

    expect(summary.settledCount).toBe(0);
    expect(summary.settledTotal).toBe('0.00');
    expect(summary.writtenOffCount).toBe(0);
    expect(summary.writtenOffTotal).toBe('0.00');
  });

  it('returns an entirely zeroed summary when there are no reconciliation rows at all', async () => {
    const repo = buildQueryBuilder([], '0');
    const service = build(repo);

    const summary = await service.getSummary();

    expect(summary).toEqual({
      pendingCount: 0,
      pendingTotal: '0.00',
      settledCount: 0,
      settledTotal: '0.00',
      writtenOffCount: 0,
      writtenOffTotal: '0.00',
      driversWithPendingDebt: 0,
    });
  });
});
