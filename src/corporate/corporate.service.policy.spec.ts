import { CorporateService } from './corporate.service';
import { CorporateAccount } from './entities/corporate-account.entity';
import { CorporateApprovalStatus } from './entities/corporate-ride-approval.entity';
import { RideCategory } from '../common/enums/ride.enum';

function fakeAccount(overrides: Record<string, any> = {}): CorporateAccount {
  return {
    id: 'account-1',
    allowedCategories: null,
    maxFarePerRide: null,
    operatingHoursStart: null,
    operatingHoursEnd: null,
    allowedCities: null,
    ...overrides,
  } as CorporateAccount;
}

function buildService() {
  // checkRidePolicy() and updatePolicy() don't touch most of the
  // constructor's other dependencies - {} as any fillers are safe
  // for everything this suite doesn't exercise.
  return new CorporateService({} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
}

const baseRide = { category: RideCategory.ECONOMY, estimatedFare: 2000, city: 'Lagos', requestedAt: new Date('2026-01-01T14:00:00') };

describe('CorporateService.checkRidePolicy() - unrestricted by default', () => {
  it('allows any ride when the account has no policy configured at all', () => {
    const service = buildService();

    const result = service.checkRidePolicy(fakeAccount(), baseRide);

    expect(result.allowed).toBe(true);
  });
});

describe('CorporateService.checkRidePolicy() - allowed categories', () => {
  it('allows a category that is on the list', () => {
    const service = buildService();
    const account = fakeAccount({ allowedCategories: [RideCategory.ECONOMY, RideCategory.COMFORT] });

    expect(service.checkRidePolicy(account, baseRide).allowed).toBe(true);
  });

  it('refuses a category that is not on the list, with a clear reason', () => {
    const service = buildService();
    const account = fakeAccount({ allowedCategories: [RideCategory.COMFORT] });

    const result = service.checkRidePolicy(account, { ...baseRide, category: RideCategory.ECONOMY });

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('economy');
  });
});

describe('CorporateService.checkRidePolicy() - max fare per ride', () => {
  it('allows a ride at or under the limit', () => {
    const service = buildService();
    const account = fakeAccount({ maxFarePerRide: '2000.00' });

    expect(service.checkRidePolicy(account, { ...baseRide, estimatedFare: 2000 }).allowed).toBe(true);
  });

  it('refuses a ride that exceeds the limit', () => {
    const service = buildService();
    const account = fakeAccount({ maxFarePerRide: '2000.00' });

    const result = service.checkRidePolicy(account, { ...baseRide, estimatedFare: 2500 });

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('2000');
  });
});

describe('CorporateService.checkRidePolicy() - allowed cities', () => {
  it('allows a city that is on the list', () => {
    const service = buildService();
    const account = fakeAccount({ allowedCities: ['Lagos', 'Abuja'] });

    expect(service.checkRidePolicy(account, { ...baseRide, city: 'Lagos' }).allowed).toBe(true);
  });

  it('refuses a city that is not on the list', () => {
    const service = buildService();
    const account = fakeAccount({ allowedCities: ['Abuja'] });

    const result = service.checkRidePolicy(account, { ...baseRide, city: 'Lagos' });

    expect(result.allowed).toBe(false);
  });

  it('does not block a ride with no city given at all, even with a city allowlist configured', () => {
    const service = buildService();
    const account = fakeAccount({ allowedCities: ['Abuja'] });

    const result = service.checkRidePolicy(account, { ...baseRide, city: null });

    expect(result.allowed).toBe(true);
  });
});

describe('CorporateService.checkRidePolicy() - operating hours', () => {
  it('allows a ride within a normal (non-wrapping) window', () => {
    const service = buildService();
    const account = fakeAccount({ operatingHoursStart: 8, operatingHoursEnd: 18 });

    const result = service.checkRidePolicy(account, { ...baseRide, requestedAt: new Date('2026-01-01T14:00:00') });

    expect(result.allowed).toBe(true);
  });

  it('refuses a ride outside a normal window', () => {
    const service = buildService();
    const account = fakeAccount({ operatingHoursStart: 8, operatingHoursEnd: 18 });

    const result = service.checkRidePolicy(account, { ...baseRide, requestedAt: new Date('2026-01-01T20:00:00') });

    expect(result.allowed).toBe(false);
  });

  it('handles a window that crosses midnight (22 -> 6) correctly - late night is INSIDE the window', () => {
    const service = buildService();
    const account = fakeAccount({ operatingHoursStart: 22, operatingHoursEnd: 6 });

    const lateNight = service.checkRidePolicy(account, { ...baseRide, requestedAt: new Date('2026-01-01T23:00:00') });
    const earlyMorning = service.checkRidePolicy(account, { ...baseRide, requestedAt: new Date('2026-01-01T03:00:00') });

    expect(lateNight.allowed).toBe(true);
    expect(earlyMorning.allowed).toBe(true);
  });

  it('handles a window that crosses midnight (22 -> 6) correctly - midday is OUTSIDE the window', () => {
    const service = buildService();
    const account = fakeAccount({ operatingHoursStart: 22, operatingHoursEnd: 6 });

    const result = service.checkRidePolicy(account, { ...baseRide, requestedAt: new Date('2026-01-01T14:00:00') });

    expect(result.allowed).toBe(false);
  });
});

describe('CorporateService.checkRidePolicy() - multiple rules combine', () => {
  it('refuses when ANY one rule is violated, even if every other rule passes', () => {
    const service = buildService();
    const account = fakeAccount({
      allowedCategories: [RideCategory.ECONOMY, RideCategory.COMFORT],
      maxFarePerRide: '1000.00', // this is the one that will fail
      allowedCities: ['Lagos'],
    });

    const result = service.checkRidePolicy(account, baseRide); // fare is 2000, over the 1000 limit

    expect(result.allowed).toBe(false);
  });

  it('allows when every configured rule passes', () => {
    const service = buildService();
    const account = fakeAccount({
      allowedCategories: [RideCategory.ECONOMY],
      maxFarePerRide: '5000.00',
      allowedCities: ['Lagos'],
      operatingHoursStart: 6,
      operatingHoursEnd: 22,
    });

    expect(service.checkRidePolicy(account, baseRide).allowed).toBe(true);
  });
});

describe('CorporateService.updatePolicy()', () => {
  it('updates only the fields actually sent, leaving the rest untouched', async () => {
    const accountsRepo = {
      findOne: jest.fn().mockResolvedValue(fakeAccount({ maxFarePerRide: '3000.00', allowedCities: ['Lagos'] })),
      save: jest.fn(async (a: any) => a),
    };
    const service = new CorporateService(accountsRepo as any, {} as any, {} as any, {} as any, {} as any, {} as any);

    const result = await service.updatePolicy('account-1', { maxFarePerRide: 5000 });

    expect(result.maxFarePerRide).toBe('5000.00');
    expect(result.allowedCities).toEqual(['Lagos']); // untouched
  });

  it('clears a field back to unrestricted when explicitly sent as null', async () => {
    const accountsRepo = {
      findOne: jest.fn().mockResolvedValue(fakeAccount({ maxFarePerRide: '3000.00' })),
      save: jest.fn(async (a: any) => a),
    };
    const service = new CorporateService(accountsRepo as any, {} as any, {} as any, {} as any, {} as any, {} as any);

    const result = await service.updatePolicy('account-1', { maxFarePerRide: null });

    expect(result.maxFarePerRide).toBeNull();
  });
});

describe('CorporateService.checkEmployeeSpendLimit()', () => {
  function buildFullService(overrides: Record<string, any> = {}) {
    const employeesRepo = {
      findOne: jest.fn().mockResolvedValue({ userId: 'employee-1', monthlySpendLimit: '5000.00', department: 'Sales' }),
      ...overrides.employeesRepo,
    };
    const txRepo = {
      createQueryBuilder: jest.fn(() => ({
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ total: overrides.spentSoFar ?? '0' }),
        getRawMany: jest.fn().mockResolvedValue([]),
      })),
      ...overrides.txRepo,
    };
    return new CorporateService({} as any, employeesRepo as any, txRepo as any, {} as any, {} as any, {} as any);
  }

  it('allows a ride when this month\'s spend + the new ride stays within the limit', async () => {
    const service = buildFullService({ spentSoFar: '3000' });

    const result = await service.checkEmployeeSpendLimit('employee-1', 1000); // 3000 + 1000 = 4000, limit 5000

    expect(result.allowed).toBe(true);
  });

  it('refuses a ride that would push this month\'s spend over the limit', async () => {
    const service = buildFullService({ spentSoFar: '4500' });

    const result = await service.checkEmployeeSpendLimit('employee-1', 1000); // 4500 + 1000 = 5500 > 5000

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('5000');
  });

  it('always allows when the employee has no monthly limit configured at all', async () => {
    const service = buildFullService({
      employeesRepo: { findOne: jest.fn().mockResolvedValue({ userId: 'employee-1', monthlySpendLimit: null }) },
    });

    const result = await service.checkEmployeeSpendLimit('employee-1', 999999);

    expect(result.allowed).toBe(true);
  });

  it('always allows for a user who is not a tracked employee at all', async () => {
    const service = buildFullService({ employeesRepo: { findOne: jest.fn().mockResolvedValue(null) } });

    const result = await service.checkEmployeeSpendLimit('not-an-employee', 999999);

    expect(result.allowed).toBe(true);
  });
});

describe('CorporateService.updateEmployee()', () => {
  it("sets an employee's department and spend limit", async () => {
    const employeesRepo = {
      findOne: jest.fn().mockResolvedValue({ userId: 'employee-1', corporateAccountId: 'account-1', department: null, monthlySpendLimit: null }),
      save: jest.fn(async (e: any) => e),
    };
    const service = new CorporateService({} as any, employeesRepo as any, {} as any, {} as any, {} as any, {} as any);

    const result = await service.updateEmployee('account-1', 'employee-1', { department: 'Engineering', monthlySpendLimit: 10000 });

    expect(result.department).toBe('Engineering');
    expect(result.monthlySpendLimit).toBe('10000.00');
  });

  it('throws when the target user is not actually an employee of THIS account', async () => {
    const employeesRepo = { findOne: jest.fn().mockResolvedValue(null) };
    const service = new CorporateService({} as any, employeesRepo as any, {} as any, {} as any, {} as any, {} as any);

    await expect(service.updateEmployee('account-1', 'not-my-employee', { department: 'Sales' })).rejects.toThrow();
  });
});

describe('CorporateService reporting - getSpendByEmployee() / getSpendByDepartment()', () => {
  it('scopes the employee spend query to DEBIT transactions for the given account only', async () => {
    const qb = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([{ employeeUserId: 'employee-1', totalSpent: '5000.00' }]),
    };
    const txRepo = { createQueryBuilder: jest.fn().mockReturnValue(qb) };
    const service = new CorporateService({} as any, {} as any, txRepo as any, {} as any, {} as any, {} as any);

    const result = await service.getSpendByEmployee('account-1');

    expect(qb.where).toHaveBeenCalledWith('tx.corporateAccountId = :accountId', { accountId: 'account-1' });
    expect(qb.andWhere).toHaveBeenCalledWith('tx.direction = :direction', { direction: 'debit' });
    expect(result).toEqual([{ employeeUserId: 'employee-1', totalSpent: '5000.00' }]);
  });

  it('groups department spend by department, excluding transactions with no department set', async () => {
    const qb = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([]),
    };
    const txRepo = { createQueryBuilder: jest.fn().mockReturnValue(qb) };
    const service = new CorporateService({} as any, {} as any, txRepo as any, {} as any, {} as any, {} as any);

    await service.getSpendByDepartment('account-1');

    expect(qb.andWhere).toHaveBeenCalledWith('tx.department IS NOT NULL');
    expect(qb.groupBy).toHaveBeenCalledWith('tx.department');
  });
});

describe('CorporateService.debitForRide() - employee/department attribution', () => {
  function buildForDebit(overrides: Record<string, any> = {}) {
    const manager = {
      findOne: jest.fn().mockResolvedValue({ id: 'account-1', budgetBalance: '10000.00', isActive: true }),
      save: jest.fn(async (_entity: any, data?: any) => data ?? _entity),
    };
    const accountsRepo = {
      manager: { transaction: jest.fn(async (cb: any) => cb(manager)) },
    };
    const employeesRepo = {
      findOne: jest.fn().mockResolvedValue({ userId: 'employee-1', department: 'Sales' }),
      ...overrides.employeesRepo,
    };
    const service = new CorporateService(accountsRepo as any, employeesRepo as any, {} as any, {} as any, {} as any, {} as any);
    return { service, manager };
  }

  it("attaches the employee's userId and CURRENT department to the resulting transaction", async () => {
    const { service, manager } = buildForDebit();

    await service.debitForRide('account-1', 1000, 'ride-1', 'employee-1');

    expect(manager.save).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ employeeUserId: 'employee-1', department: 'Sales' }),
    );
  });

  it('stores a null department when the employee has none set, rather than omitting the field', async () => {
    const { service, manager } = buildForDebit({
      employeesRepo: { findOne: jest.fn().mockResolvedValue({ userId: 'employee-1', department: null }) },
    });

    await service.debitForRide('account-1', 1000, 'ride-1', 'employee-1');

    expect(manager.save).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ department: null }));
  });
});

describe('CorporateService.flagRideForApprovalIfNeeded()', () => {
  function buildForFlag(overrides: Record<string, any> = {}) {
    const approvalsRepo = {
      save: jest.fn(async (d: any) => d),
      create: jest.fn((d: any) => d),
      ...overrides.approvalsRepo,
    };
    const events = { emit: jest.fn() };
    const service = new CorporateService({} as any, {} as any, {} as any, {} as any, approvalsRepo as any, events as any);
    return { service, approvalsRepo, events };
  }

  it('does nothing when the account has no approval threshold configured', async () => {
    const { service, approvalsRepo } = buildForFlag();
    const account = fakeAccount({ requiresApprovalAboveFare: null });

    await service.flagRideForApprovalIfNeeded(account, 'ride-1', 'employee-1', 50000);

    expect(approvalsRepo.save).not.toHaveBeenCalled();
  });

  it('does nothing when the fare is at or under the threshold', async () => {
    const { service, approvalsRepo } = buildForFlag();
    const account = fakeAccount({ requiresApprovalAboveFare: '10000.00' });

    await service.flagRideForApprovalIfNeeded(account, 'ride-1', 'employee-1', 10000);

    expect(approvalsRepo.save).not.toHaveBeenCalled();
  });

  it('creates a PENDING approval record and notifies the owner when the fare exceeds the threshold', async () => {
    const { service, approvalsRepo, events } = buildForFlag();
    const account = fakeAccount({ id: 'account-1', ownerUserId: 'owner-1', requiresApprovalAboveFare: '10000.00' });

    await service.flagRideForApprovalIfNeeded(account, 'ride-1', 'employee-1', 15000);

    expect(approvalsRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ corporateAccountId: 'account-1', rideId: 'ride-1', employeeUserId: 'employee-1', fareAmount: '15000.00' }),
    );
    expect(events.emit).toHaveBeenCalledWith('corporate.ride_flagged_for_approval', { ownerId: 'owner-1', rideId: 'ride-1', fareAmount: 15000 });
  });
});

describe('CorporateService.reviewApproval() - tenant isolation and state', () => {
  function buildForReview(overrides: Record<string, any> = {}) {
    const approvalsRepo = {
      findOne: jest.fn().mockResolvedValue({ id: 'approval-1', corporateAccountId: 'account-1', status: 'pending' }),
      save: jest.fn(async (d: any) => d),
      ...overrides.approvalsRepo,
    };
    const service = new CorporateService({} as any, {} as any, {} as any, {} as any, approvalsRepo as any, {} as any);
    return { service, approvalsRepo };
  }

  it("refuses to review an approval that doesn't belong to the calling account at all", async () => {
    const { service, approvalsRepo } = buildForReview({ approvalsRepo: { findOne: jest.fn().mockResolvedValue(null) } });

    await expect(
      service.reviewApproval('account-1', 'someone-elses-approval', 'owner-1', CorporateApprovalStatus.APPROVED),
    ).rejects.toThrow();
    expect(approvalsRepo.save).not.toHaveBeenCalled();
  });

  it('refuses to review an approval that has already been decided', async () => {
    const { service } = buildForReview({
      approvalsRepo: { findOne: jest.fn().mockResolvedValue({ id: 'approval-1', corporateAccountId: 'account-1', status: 'approved' }) },
    });

    await expect(
      service.reviewApproval('account-1', 'approval-1', 'owner-1', CorporateApprovalStatus.REJECTED),
    ).rejects.toThrow();
  });

  it('records the reviewer, status, notes, and timestamp on a successful review', async () => {
    const { service, approvalsRepo } = buildForReview();

    const result = await service.reviewApproval('account-1', 'approval-1', 'owner-1', CorporateApprovalStatus.REJECTED, 'Personal trip, not approved');

    expect(result.status).toBe(CorporateApprovalStatus.REJECTED);
    expect(result.reviewedBy).toBe('owner-1');
    expect(result.reviewNotes).toBe('Personal trip, not approved');
    expect(result.reviewedAt).toBeInstanceOf(Date);
  });
});
