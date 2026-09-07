import { IncentivesService } from './incentives.service';
import { IncentiveProgressStatus } from './entities/driver-incentive-progress.entity';

function fakeProgress(overrides: Record<string, any> = {}) {
  return {
    id: 'progress-1',
    incentiveId: 'incentive-1',
    driverId: 'driver-1',
    tripsCompleted: 5,
    status: IncentiveProgressStatus.IN_PROGRESS,
    ...overrides,
  };
}

function build(overrides: Record<string, any> = {}) {
  const incentivesRepo = { save: jest.fn(), create: jest.fn(), find: jest.fn(), update: jest.fn(), findOne: jest.fn() };
  const progressRepo = {
    find: jest.fn().mockResolvedValue([]),
    ...overrides.progressRepo,
  };
  const driversService = {};
  const walletsService = {};
  const events = { emit: jest.fn() };

  const service = new IncentivesService(
    incentivesRepo as any,
    progressRepo as any,
    driversService as any,
    walletsService as any,
    events as any,
  );

  return { service, progressRepo };
}

describe('IncentivesService.getProgressSummary()', () => {
  it(
    'derives participantCount/completedCount/rewardedCount from the same rows returned in items, ' +
      'as a funnel (participants >= completed >= rewarded)',
    async () => {
      const { service } = build({
        progressRepo: {
          find: jest.fn().mockResolvedValue([
            fakeProgress({ status: IncentiveProgressStatus.IN_PROGRESS }),
            fakeProgress({ status: IncentiveProgressStatus.COMPLETED }),
            fakeProgress({ status: IncentiveProgressStatus.REWARDED }),
            fakeProgress({ status: IncentiveProgressStatus.REWARDED }),
          ]),
        },
      });

      const summary = await service.getProgressSummary('incentive-1');

      expect(summary.participantCount).toBe(4);
      expect(summary.completedCount).toBe(3); // COMPLETED + REWARDED both count as "finished the requirement"
      expect(summary.rewardedCount).toBe(2);
      expect(summary.items).toHaveLength(4);
    },
  );

  it('returns all zeroes for an incentive nobody has made progress on yet', async () => {
    const { service } = build();
    const summary = await service.getProgressSummary('incentive-1');
    expect(summary).toEqual({ participantCount: 0, completedCount: 0, rewardedCount: 0, items: [] });
  });

  it('only counts progress rows for the given incentive', async () => {
    const { service, progressRepo } = build();
    await service.getProgressSummary('incentive-1');
    expect(progressRepo.find).toHaveBeenCalledWith(expect.objectContaining({ where: { incentiveId: 'incentive-1' } }));
  });
});
