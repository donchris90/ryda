import { RiskEngineService, RiskBand } from './risk-engine.service';
import { FraudFlagSeverity, FraudFlagStatus, FraudFlagType } from './entities/fraud-flag.entity';

function fakeFlag(overrides: Partial<any> = {}) {
  return {
    id: `flag-${Math.random()}`,
    userId: 'user-1',
    type: FraudFlagType.GPS_SPOOF,
    severity: FraudFlagSeverity.LOW,
    status: FraudFlagStatus.OPEN,
    createdAt: new Date(),
    details: null,
    ...overrides,
  };
}

function build(overrides: Record<string, any> = {}) {
  const flagsRepo = { find: jest.fn().mockResolvedValue([]), ...overrides.flagsRepo };
  // Defaults match the service's own documented default weights/thresholds -
  // tests override individual keys to exercise configurability.
  const settingsValues: Record<string, number> = {
    'risk.lookbackDays': 30,
    'risk.weightLow': 5,
    'risk.weightMedium': 15,
    'risk.weightHigh': 35,
    'risk.weightCritical': 70,
    'risk.thresholdMedium': 20,
    'risk.thresholdHigh': 50,
    'risk.thresholdCritical': 90,
    ...overrides.settingsValues,
  };
  const settingsService = {
    getNumber: jest.fn((key: string, fallback: number) => Promise.resolve(settingsValues[key] ?? fallback)),
  };

  const service = new RiskEngineService(flagsRepo as any, settingsService as any);
  return { service, flagsRepo, settingsService };
}

describe('RiskEngineService.assess() - scoring and banding', () => {
  it('scores a user with no flags at all as LOW with a zero score', async () => {
    const { service } = build();

    const result = await service.assess('user-1');

    expect(result).toEqual({ userId: 'user-1', score: 0, band: RiskBand.LOW, reasons: [] });
  });

  it('a single LOW-severity flag alone never reaches HIGH or CRITICAL - the whole point of aggregating, not acting on one heuristic', async () => {
    const { service, flagsRepo } = build();
    flagsRepo.find.mockResolvedValue([fakeFlag({ severity: FraudFlagSeverity.LOW })]);

    const result = await service.assess('user-1');

    expect(result.score).toBe(5);
    expect(result.band).toBe(RiskBand.LOW);
  });

  it('a single CRITICAL-severity flag alone is still enough to reach HIGH (not necessarily CRITICAL) - severity is respected, not flattened', async () => {
    const { service, flagsRepo } = build();
    flagsRepo.find.mockResolvedValue([fakeFlag({ severity: FraudFlagSeverity.CRITICAL })]);

    const result = await service.assess('user-1');

    expect(result.score).toBe(70);
    expect(result.band).toBe(RiskBand.HIGH); // 70 >= thresholdHigh(50) but < thresholdCritical(90)
  });

  it('sums multiple flags to cross a higher band than any single one would reach alone', async () => {
    const { service, flagsRepo } = build();
    flagsRepo.find.mockResolvedValue([
      fakeFlag({ severity: FraudFlagSeverity.HIGH }), // 35
      fakeFlag({ severity: FraudFlagSeverity.HIGH }), // 35
      fakeFlag({ severity: FraudFlagSeverity.MEDIUM }), // 15
    ]);

    const result = await service.assess('user-1');

    expect(result.score).toBe(85);
    expect(result.band).toBe(RiskBand.HIGH);
  });

  it('reaches CRITICAL only once accumulated score crosses the critical threshold', async () => {
    const { service, flagsRepo } = build();
    flagsRepo.find.mockResolvedValue([
      fakeFlag({ severity: FraudFlagSeverity.CRITICAL }), // 70
      fakeFlag({ severity: FraudFlagSeverity.HIGH }), // 35 -> 105 total
    ]);

    const result = await service.assess('user-1');

    expect(result.band).toBe(RiskBand.CRITICAL);
  });

  it('every reason is explainable - traceable back to a specific flag with its type, severity, and weight', async () => {
    const { service, flagsRepo } = build();
    const flag = fakeFlag({ id: 'flag-abc', type: FraudFlagType.GPS_SPOOF, severity: FraudFlagSeverity.HIGH });
    flagsRepo.find.mockResolvedValue([flag]);

    const result = await service.assess('user-1');

    expect(result.reasons).toEqual([
      expect.objectContaining({ flagId: 'flag-abc', type: FraudFlagType.GPS_SPOOF, severity: FraudFlagSeverity.HIGH, weight: 35 }),
    ]);
  });

  it('respects admin-configured weights and thresholds rather than hardcoded defaults', async () => {
    const { service, flagsRepo } = build({
      settingsValues: { 'risk.weightLow': 25, 'risk.thresholdMedium': 20, 'risk.thresholdHigh': 50 },
    });
    flagsRepo.find.mockResolvedValue([fakeFlag({ severity: FraudFlagSeverity.LOW })]);

    const result = await service.assess('user-1');

    expect(result.score).toBe(25);
    expect(result.band).toBe(RiskBand.MEDIUM);
  });

  it('only queries flags within the configured lookback window', async () => {
    const { service, flagsRepo } = build({ settingsValues: { 'risk.lookbackDays': 7 } });
    flagsRepo.find.mockResolvedValue([]);

    await service.assess('user-1');

    const whereArg = flagsRepo.find.mock.calls[0][0].where;
    // where is an array of two clauses (OPEN, REVIEWED) sharing the same createdAt filter
    expect(whereArg[0].createdAt).toBeDefined();
    expect(whereArg[1].status).toBe(FraudFlagStatus.REVIEWED);
  });

  it('never queries for DISMISSED flags - an admin-confirmed false positive must stop contributing entirely', async () => {
    const { service, flagsRepo } = build();

    await service.assess('user-1');

    const whereArg = flagsRepo.find.mock.calls[0][0].where;
    const queriedStatuses = whereArg.map((clause: any) => clause.status);
    expect(queriedStatuses).toEqual([FraudFlagStatus.OPEN, FraudFlagStatus.REVIEWED]);
    expect(queriedStatuses).not.toContain(FraudFlagStatus.DISMISSED);
  });
});
