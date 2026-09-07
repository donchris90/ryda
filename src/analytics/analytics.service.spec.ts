import { AnalyticsService } from './analytics.service';
import { PoolGroupStatus } from '../pooling/entities/pool-group.entity';

function makeQueryBuilder(rawOneResult?: any, rawManyResult: any[] = []) {
  const qb: any = {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getRawOne: jest.fn().mockResolvedValue(rawOneResult),
    getRawMany: jest.fn().mockResolvedValue(rawManyResult),
  };
  return qb;
}

function build(overrides: Record<string, any> = {}) {
  const ridesRepo = {
    count: jest.fn().mockResolvedValue(0),
    createQueryBuilder: jest.fn().mockReturnValue(makeQueryBuilder({ total: '0' })),
    ...overrides.ridesRepo,
  };
  const usersRepo = { count: jest.fn() };
  const driversRepo = { count: jest.fn() };
  const poolGroupsRepo = {
    count: jest.fn().mockResolvedValue(0),
    createQueryBuilder: jest.fn().mockReturnValue(makeQueryBuilder(undefined, [])),
    ...overrides.poolGroupsRepo,
  };

  const service = new AnalyticsService(ridesRepo as any, usersRepo as any, driversRepo as any, poolGroupsRepo as any);
  return { service, ridesRepo, poolGroupsRepo };
}

describe('AnalyticsService.getPoolingOverview()', () => {
  it(
    'derives matchedCount from PoolGroup, not Ride.poolGroupId - PoolGroup rows survive an unwound match, ' +
      'so this reflects every match that ever happened, not just ones still active right now',
    async () => {
      const { service, ridesRepo, poolGroupsRepo } = build({
        ridesRepo: {
          count: jest.fn().mockResolvedValue(200), // totalPoolRequests
          createQueryBuilder: jest.fn().mockReturnValue(makeQueryBuilder({ total: '15000.00' })),
        },
        poolGroupsRepo: {
          count: jest.fn().mockImplementation((opts?: any) => {
            if (opts?.where?.status === PoolGroupStatus.COMPLETED) return Promise.resolve(60);
            return Promise.resolve(80); // total ever matched
          }),
        },
      });

      const result = await service.getPoolingOverview();

      expect(result.totalPoolRequests).toBe(200);
      expect(result.matchedCount).toBe(80);
      expect(result.completedPooledRides).toBe(120); // 60 completed groups * 2 rides each
      expect(result.matchRatePercent).toBe(40); // 80/200 * 100
      expect(result.totalDiscountGivenNaira).toBe('15000.00');
    },
  );

  it('returns a 0% match rate (not NaN) when there have been no pool requests at all', async () => {
    const { service } = build({ ridesRepo: { count: jest.fn().mockResolvedValue(0), createQueryBuilder: jest.fn().mockReturnValue(makeQueryBuilder({ total: null })) } });
    const result = await service.getPoolingOverview();
    expect(result.matchRatePercent).toBe(0);
    expect(Number.isFinite(result.matchRatePercent)).toBe(true);
  });

  it('treats a null discount sum (no rows) as ₦0.00, not NaN', async () => {
    const { service } = build({
      ridesRepo: { count: jest.fn().mockResolvedValue(0), createQueryBuilder: jest.fn().mockReturnValue(makeQueryBuilder({ total: null })) },
    });
    const result = await service.getPoolingOverview();
    expect(result.totalDiscountGivenNaira).toBe('0.00');
  });
});

describe('AnalyticsService.getPoolingTrend()', () => {
  it('merges request and match counts by period from two independent queries', async () => {
    const { service, ridesRepo, poolGroupsRepo } = build({
      ridesRepo: {
        createQueryBuilder: jest.fn().mockReturnValue(
          makeQueryBuilder(undefined, [
            { period: '2026-09-01', requested: '10' },
            { period: '2026-09-02', requested: '20' },
          ]),
        ),
      },
      poolGroupsRepo: {
        createQueryBuilder: jest.fn().mockReturnValue(
          makeQueryBuilder(undefined, [{ period: '2026-09-01', groups: '3' }]),
        ),
      },
    });

    const result = await service.getPoolingTrend('day');

    expect(result).toEqual([
      { period: '2026-09-01', matched: 6, unmatched: 4 }, // 3 groups * 2 = 6 matched rides, 10 requested - 6
      { period: '2026-09-02', matched: 0, unmatched: 20 },
    ]);
  });

  it('never returns a negative unmatched count, even if matches in a period exceed that period\'s requests (cross-period matching lag)', async () => {
    const { service } = build({
      ridesRepo: {
        createQueryBuilder: jest.fn().mockReturnValue(makeQueryBuilder(undefined, [{ period: '2026-09-01', requested: '2' }])),
      },
      poolGroupsRepo: {
        createQueryBuilder: jest.fn().mockReturnValue(makeQueryBuilder(undefined, [{ period: '2026-09-01', groups: '5' }])),
      },
    });

    const result = await service.getPoolingTrend('day');

    expect(result[0].unmatched).toBe(0); // not -8
  });

  it('includes a period that only has matches and no same-period requests', async () => {
    const { service } = build({
      ridesRepo: { createQueryBuilder: jest.fn().mockReturnValue(makeQueryBuilder(undefined, [])) },
      poolGroupsRepo: {
        createQueryBuilder: jest.fn().mockReturnValue(makeQueryBuilder(undefined, [{ period: '2026-09-05', groups: '1' }])),
      },
    });

    const result = await service.getPoolingTrend('day');

    expect(result).toEqual([{ period: '2026-09-05', matched: 2, unmatched: 0 }]);
  });

  it('returns an empty array when there is no pooling activity at all', async () => {
    const { service } = build();
    const result = await service.getPoolingTrend('day');
    expect(result).toEqual([]);
  });
});
