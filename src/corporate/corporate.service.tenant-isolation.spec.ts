import { ConflictException } from '@nestjs/common';
import { CorporateService } from './corporate.service';

function build(overrides: Record<string, any> = {}) {
  const accountsRepo = {
    findOne: jest.fn(({ where }: any) => {
      const accounts: any[] = overrides.accounts ?? [{ id: 'account-a', ownerUserId: 'owner-a', budgetBalance: '10000.00' }];
      return Promise.resolve(accounts.find((a) => a.id === where.id) ?? null);
    }),
    save: jest.fn(async (d: any) => d),
    create: jest.fn((d: any) => d),
    ...overrides.accountsRepo,
  };

  const employeesRepo = {
    findOne: jest.fn(({ where }: any) => {
      const employees: any[] = overrides.employees ?? [{ userId: 'employee-a', corporateAccountId: 'account-a', isActive: true }];
      return Promise.resolve(
        employees.find((e) => e.userId === where.userId && (where.isActive === undefined || e.isActive === where.isActive)) ?? null,
      );
    }),
    save: jest.fn(async (d: any) => d),
    create: jest.fn((d: any) => d),
    ...overrides.employeesRepo,
  };
  const txRepo = { find: jest.fn().mockResolvedValue([]) };
  const usersService = { findById: jest.fn().mockResolvedValue({ id: 'some-user' }) };

  const service = new CorporateService(accountsRepo as any, employeesRepo as any, txRepo as any, usersService as any, {} as any, {} as any);
  return { service, accountsRepo, employeesRepo };
}

describe('CorporateService.getAccountForEmployee() - the resolver every ride-billing and /mine call depends on', () => {
  it("resolves an employee to THEIR OWN employer's account", async () => {
    const { service } = build();

    const account = await service.getAccountForEmployee('employee-a');

    expect(account?.id).toBe('account-a');
  });

  it('never resolves to a DIFFERENT company than the one this employee actually belongs to', async () => {
    const { service } = build({
      employees: [{ userId: 'employee-a', corporateAccountId: 'account-a', isActive: true }],
      accounts: [
        { id: 'account-a', ownerUserId: 'owner-a' },
        { id: 'account-b', ownerUserId: 'owner-b' },
      ],
    });

    const account = await service.getAccountForEmployee('employee-a');

    expect(account?.id).toBe('account-a');
    expect(account?.id).not.toBe('account-b');
  });

  it('returns null (not another account, not an error that could be mishandled) for a user with no employment record at all', async () => {
    const { service } = build({ employees: [] });

    expect(await service.getAccountForEmployee('stranger')).toBeNull();
  });

  it('returns null for a DEACTIVATED employee - a former employee must not still bill rides to their old employer', async () => {
    const { service } = build({
      employees: [{ userId: 'employee-a', corporateAccountId: 'account-a', isActive: false }],
    });

    expect(await service.getAccountForEmployee('employee-a')).toBeNull();
  });
});

describe('CorporateService.addEmployee() - cross-company employment conflicts', () => {
  it('refuses to add a user who already belongs to ANY corporate account, including a different one', async () => {
    const { service } = build({
      employeesRepo: {
        findOne: jest.fn().mockResolvedValue({ userId: 'already-employed', corporateAccountId: 'account-b' }),
      },
    });

    await expect(service.addEmployee('account-a', 'already-employed')).rejects.toThrow(ConflictException);
  });
});
