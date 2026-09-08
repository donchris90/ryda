import { BadRequestException, NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';

function fakeUser(overrides: Record<string, any> = {}) {
  return {
    id: 'user-1',
    firstName: 'Ada',
    lastName: 'Okoye',
    email: 'ada@example.com',
    phone: '+2348011111111',
    isEmailVerified: true,
    isPhoneVerified: true,
    ...overrides,
  };
}

function build(overrides: Record<string, any> = {}) {
  const usersRepo = {
    findOne: jest.fn().mockResolvedValue(fakeUser()),
    save: jest.fn(async (u: any) => u),
    ...overrides.usersRepo,
  };
  const service = new UsersService(usersRepo as any);
  return { service, usersRepo };
}

describe('UsersService.updateProfile()', () => {
  it('updates firstName/lastName without touching verification flags', async () => {
    const { service } = build();
    const result = await service.updateProfile('user-1', { firstName: 'Chiamaka' });
    expect(result.firstName).toBe('Chiamaka');
    expect(result.isEmailVerified).toBe(true);
    expect(result.isPhoneVerified).toBe(true);
  });

  it(
    'resets isEmailVerified to false when the email actually changes - a new, unconfirmed email must ' +
      'not keep showing as verified',
    async () => {
      const { service } = build();
      const result = await service.updateProfile('user-1', { email: 'new@example.com' });
      expect(result.email).toBe('new@example.com');
      expect(result.isEmailVerified).toBe(false);
    },
  );

  it('does not reset isEmailVerified when the email is resubmitted unchanged', async () => {
    const { service } = build();
    const result = await service.updateProfile('user-1', { email: 'ada@example.com' });
    expect(result.isEmailVerified).toBe(true);
  });

  it('resets isPhoneVerified to false when the phone actually changes', async () => {
    const { service } = build();
    const result = await service.updateProfile('user-1', { phone: '+2348022222222' });
    expect(result.phone).toBe('+2348022222222');
    expect(result.isPhoneVerified).toBe(false);
  });

  it('rejects an email already used by a different account', async () => {
    const { service } = build({
      usersRepo: {
        findOne: jest.fn((opts: any) => {
          if (opts.where?.email) return Promise.resolve(fakeUser({ id: 'other-user', email: 'taken@example.com' }));
          return Promise.resolve(fakeUser());
        }),
      },
    });
    await expect(service.updateProfile('user-1', { email: 'taken@example.com' })).rejects.toThrow(BadRequestException);
  });

  it('rejects a phone number already used by a different account', async () => {
    const { service } = build({
      usersRepo: {
        findOne: jest.fn((opts: any) => {
          if (opts.where?.phone) return Promise.resolve(fakeUser({ id: 'other-user', phone: '+2348033333333' }));
          return Promise.resolve(fakeUser());
        }),
      },
    });
    await expect(service.updateProfile('user-1', { phone: '+2348033333333' })).rejects.toThrow(BadRequestException);
  });

  it('allows "changing" an email/phone to the same value already on your own account', async () => {
    const { service } = build({
      usersRepo: {
        findOne: jest.fn((opts: any) => {
          if (opts.where?.email) return Promise.resolve(fakeUser()); // same user, same email
          return Promise.resolve(fakeUser());
        }),
      },
    });
    await expect(service.updateProfile('user-1', { email: 'ada@example.com' })).resolves.toBeDefined();
  });

  it('throws NotFoundException for a user that does not exist', async () => {
    const { service } = build({ usersRepo: { findOne: jest.fn().mockResolvedValue(null) } });
    await expect(service.updateProfile('missing', { firstName: 'X' })).rejects.toThrow(NotFoundException);
  });
});
