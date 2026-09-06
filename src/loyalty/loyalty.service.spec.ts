import { LoyaltyService } from './loyalty.service';
import { LoyaltyAccount, LoyaltyTier } from './entities/loyalty-account.entity';

function fakeAccount(overrides: Partial<LoyaltyAccount> = {}): LoyaltyAccount {
  return {
    id: 'acct-1',
    userId: 'user-1',
    pointsBalance: 0,
    lifetimePoints: 0,
    tier: LoyaltyTier.BRONZE,
    updatedAt: new Date(),
    ...overrides,
  } as LoyaltyAccount;
}

function build(account: LoyaltyAccount | null) {
  const accountsRepo = {
    findOne: jest.fn().mockResolvedValue(account),
    create: jest.fn((d: any) => ({ ...fakeAccount(), ...d })),
    save: jest.fn(async (d: any) => d),
  } as any;
  const transactionsRepo = {} as any;
  const walletsService = {} as any;
  const service = new LoyaltyService(accountsRepo, transactionsRepo, walletsService);
  return { service };
}

describe('LoyaltyService.getAccountSummary()', () => {
  it('computes points remaining to the next tier for a BRONZE account', async () => {
    const { service } = build(fakeAccount({ tier: LoyaltyTier.BRONZE, lifetimePoints: 200 }));
    const summary = await service.getAccountSummary('user-1');
    expect(summary.nextTier).toBe(LoyaltyTier.SILVER);
    expect(summary.pointsToNextTier).toBe(300); // SILVER threshold (500) - 200
  });

  it('computes points remaining to the next tier for a SILVER account approaching GOLD', async () => {
    const { service } = build(fakeAccount({ tier: LoyaltyTier.SILVER, lifetimePoints: 1800 }));
    const summary = await service.getAccountSummary('user-1');
    expect(summary.nextTier).toBe(LoyaltyTier.GOLD);
    expect(summary.pointsToNextTier).toBe(200); // GOLD threshold (2000) - 1800
  });

  it('reports no next tier once at PLATINUM - nothing further to reach', async () => {
    const { service } = build(fakeAccount({ tier: LoyaltyTier.PLATINUM, lifetimePoints: 6000 }));
    const summary = await service.getAccountSummary('user-1');
    expect(summary.nextTier).toBeNull();
    expect(summary.pointsToNextTier).toBeNull();
  });

  it('surfaces the actual earn/redeem rates rather than the client having to know them separately', async () => {
    const { service } = build(fakeAccount());
    const summary = await service.getAccountSummary('user-1');
    expect(summary.pointsPerNairaSpent).toBeGreaterThan(0);
    expect(summary.nairaPerPointRedeemed).toBeGreaterThan(0);
    expect(summary.minRedemptionPoints).toBeGreaterThan(0);
  });
});
