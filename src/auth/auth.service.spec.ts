import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';

function fakeUser(overrides: Record<string, any> = {}) {
  return {
    id: 'user-1',
    role: 'passenger',
    email: 'ada@example.com',
    passwordHash: 'irrelevant',
    isActive: true,
    isEmailVerified: true,
    ...overrides,
  };
}

function buildService(overrides: Record<string, any> = {}) {
  const refreshTokenRepo = {
    findOne: jest.fn(),
    save: jest.fn(async (r: any) => ({ id: 'session-1', ...r })),
    create: jest.fn((d: any) => d),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    find: jest.fn().mockResolvedValue([]),
    ...overrides.refreshTokenRepo,
  };

  const deps = {
    refreshTokenRepo,
    usersService: { findById: jest.fn().mockResolvedValue(fakeUser()), findByEmailWithPassword: jest.fn() },
    walletsService: {},
    jwtService: {
      sign: jest.fn().mockReturnValue('signed-token'),
      verify: jest.fn().mockReturnValue({ sub: 'user-1', role: 'passenger' }),
    },
    config: { get: jest.fn().mockReturnValue('1h') },
    auditService: { log: jest.fn().mockResolvedValue(undefined) },
    fraudService: { recordDeviceFingerprint: jest.fn().mockResolvedValue({ isNewDevice: false }) },
    notificationsService: { notify: jest.fn().mockResolvedValue(undefined) },
    otpService: {},
    authTokensService: {},
    mailerService: {},
    ...overrides.deps,
  };

  const service = new AuthService(
    deps.refreshTokenRepo as any,
    deps.usersService as any,
    deps.walletsService as any,
    deps.jwtService as any,
    deps.config as any,
    deps.auditService as any,
    deps.fraudService as any,
    deps.notificationsService as any,
    deps.otpService as any,
    deps.authTokensService as any,
    deps.mailerService as any,
  );

  return { service, deps };
}

describe('AuthService.listSessions()', () => {
  it('returns only this user\'s non-revoked, non-expired sessions, most recent first', async () => {
    const { service, deps } = buildService();
    const sessions = [{ id: 's1', userId: 'user-1', revoked: false }];
    deps.refreshTokenRepo.find.mockResolvedValue(sessions);

    const result = await service.listSessions('user-1');

    expect(result).toBe(sessions);
    expect(deps.refreshTokenRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 'user-1', revoked: false }),
        order: { createdAt: 'DESC' },
      }),
    );
  });
});

describe('AuthService.revokeSession()', () => {
  it('revokes a session scoped to the requesting user', async () => {
    const { service, deps } = buildService();

    await service.revokeSession('user-1', 'session-1');

    expect(deps.refreshTokenRepo.update).toHaveBeenCalledWith(
      { id: 'session-1', userId: 'user-1', revoked: false },
      { revoked: true },
    );
  });

  it("throws when the session doesn't exist or belongs to someone else, rather than silently no-op'ing", async () => {
    const { service, deps } = buildService();
    deps.refreshTokenRepo.update.mockResolvedValue({ affected: 0 });

    await expect(service.revokeSession('user-1', 'not-mine')).rejects.toThrow(BadRequestException);
  });
});

describe('AuthService.refresh() - session context carryover', () => {
  it("falls back to the rotating-away token's own recorded context when the caller supplies none", async () => {
    const { service, deps } = buildService();
    deps.refreshTokenRepo.findOne.mockResolvedValue({
      id: 'old-session',
      userId: 'user-1',
      expiresAt: new Date(Date.now() + 100000),
      revoked: false,
      deviceFingerprint: 'fp-abc',
      ipAddress: '1.2.3.4',
      userAgent: 'OldAgent/1.0',
    });

    await service.refresh('a-refresh-token', {});

    expect(deps.refreshTokenRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ deviceFingerprint: 'fp-abc', ipAddress: '1.2.3.4', userAgent: 'OldAgent/1.0' }),
    );
  });

  it('prefers freshly-supplied context over the old session\'s recorded values', async () => {
    const { service, deps } = buildService();
    deps.refreshTokenRepo.findOne.mockResolvedValue({
      id: 'old-session',
      userId: 'user-1',
      expiresAt: new Date(Date.now() + 100000),
      revoked: false,
      deviceFingerprint: 'fp-old',
      ipAddress: '1.2.3.4',
      userAgent: 'OldAgent/1.0',
    });

    await service.refresh('a-refresh-token', { ipAddress: '9.9.9.9', userAgent: 'NewAgent/2.0' });

    expect(deps.refreshTokenRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ deviceFingerprint: 'fp-old', ipAddress: '9.9.9.9', userAgent: 'NewAgent/2.0' }),
    );
  });

  it('revokes every session for the user when a already-revoked token is presented (reuse detection)', async () => {
    const { service, deps } = buildService();
    deps.refreshTokenRepo.findOne.mockResolvedValue({
      id: 'old-session',
      userId: 'user-1',
      expiresAt: new Date(Date.now() + 100000),
      revoked: true,
    });

    await expect(service.refresh('a-refresh-token')).rejects.toThrow(UnauthorizedException);
    expect(deps.refreshTokenRepo.update).toHaveBeenCalledWith({ userId: 'user-1' }, { revoked: true });
  });
});

describe('AuthService.login() - new-device notification', () => {
  it('notifies the user (in-app + email) when recordDeviceFingerprint reports a genuinely new device', async () => {
    const passwordHash = await bcrypt.hash('correct-password', 4);
    const { service, deps } = buildService({
      deps: {
        usersService: {
          findByEmailWithPassword: jest.fn().mockResolvedValue(fakeUser({ passwordHash })),
          findById: jest.fn().mockResolvedValue(fakeUser({ passwordHash })),
        },
        fraudService: { recordDeviceFingerprint: jest.fn().mockResolvedValue({ isNewDevice: true }) },
      },
    });

    await service.login({ email: 'ada@example.com', password: 'correct-password', deviceFingerprint: 'fp-new' } as any, {
      ipAddress: '5.6.7.8',
    });

    expect(deps.notificationsService.notify).toHaveBeenCalledWith(
      'user-1',
      expect.arrayContaining(['in_app', 'email']),
      expect.stringContaining('New login'),
      expect.stringContaining('5.6.7.8'),
      undefined,
      'security',
    );
  });

  it('does not notify when the device is already known (isNewDevice: false)', async () => {
    const passwordHash = await bcrypt.hash('correct-password', 4);
    const { service, deps } = buildService({
      deps: {
        usersService: {
          findByEmailWithPassword: jest.fn().mockResolvedValue(fakeUser({ passwordHash })),
          findById: jest.fn().mockResolvedValue(fakeUser({ passwordHash })),
        },
        fraudService: { recordDeviceFingerprint: jest.fn().mockResolvedValue({ isNewDevice: false }) },
      },
    });

    await service.login({ email: 'ada@example.com', password: 'correct-password', deviceFingerprint: 'fp-known' } as any);

    expect(deps.notificationsService.notify).not.toHaveBeenCalled();
  });

  it('a login failure never reaches the new-device check at all', async () => {
    const { service, deps } = buildService({
      deps: { usersService: { findByEmailWithPassword: jest.fn().mockResolvedValue(null) } },
    });

    await expect(
      service.login({ email: 'nope@example.com', password: 'x' } as any),
    ).rejects.toThrow(UnauthorizedException);

    expect(deps.fraudService.recordDeviceFingerprint).not.toHaveBeenCalled();
    expect(deps.notificationsService.notify).not.toHaveBeenCalled();
  });
});
