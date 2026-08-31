import { FraudService } from './fraud.service';
import { FraudFlagSeverity, FraudFlagStatus, FraudFlagType } from './entities/fraud-flag.entity';
import { NotFoundException } from '@nestjs/common';

function buildService(overrides: Record<string, any> = {}) {
  const devicesRepo = {
    findOne: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockResolvedValue([]),
    create: jest.fn((data) => data),
    save: jest.fn(async (data) => data),
    ...overrides.devicesRepo,
  };

  const flagsRepo = {
    create: jest.fn((data) => ({ id: 'flag-1', ...data })),
    save: jest.fn(async (data) => data),
    findOne: jest.fn(),
    createQueryBuilder: jest.fn(),
    ...overrides.flagsRepo,
  };

  const service = new FraudService(devicesRepo as any, flagsRepo as any);
  return { service, devicesRepo, flagsRepo };
}

describe('FraudService.recordDeviceFingerprint', () => {
  it('does nothing when no fingerprint is provided', async () => {
    const { service, devicesRepo } = buildService();
    await service.recordDeviceFingerprint('user-1', '');
    expect(devicesRepo.save).not.toHaveBeenCalled();
  });

  it('creates a new device record and raises no flag when the fingerprint is unique to this user', async () => {
    const { service, devicesRepo, flagsRepo } = buildService({
      devicesRepo: {
        findOne: jest.fn().mockResolvedValue(null),
        find: jest.fn().mockResolvedValue([{ userId: 'user-1', fingerprint: 'fp-1' }]),
      },
    });

    await service.recordDeviceFingerprint('user-1', 'fp-1', '1.2.3.4');

    expect(devicesRepo.save).toHaveBeenCalled();
    expect(flagsRepo.save).not.toHaveBeenCalled();
  });

  it('updates the existing record\'s IP rather than creating a duplicate when the user/fingerprint pair already exists', async () => {
    const existing = { userId: 'user-1', fingerprint: 'fp-1', ipAddress: 'old-ip' };
    const { service, devicesRepo } = buildService({
      devicesRepo: {
        findOne: jest.fn().mockResolvedValue(existing),
        find: jest.fn().mockResolvedValue([existing]),
      },
    });

    await service.recordDeviceFingerprint('user-1', 'fp-1', 'new-ip');

    expect(devicesRepo.create).not.toHaveBeenCalled();
    expect(existing.ipAddress).toBe('new-ip');
  });

  it('raises a MEDIUM flag when the fingerprint is shared with exactly one other user', async () => {
    const { service, flagsRepo } = buildService({
      devicesRepo: {
        findOne: jest.fn().mockResolvedValue(null),
        find: jest.fn().mockResolvedValue([
          { userId: 'user-1', fingerprint: 'fp-1' },
          { userId: 'user-2', fingerprint: 'fp-1' },
        ]),
      },
    });

    await service.recordDeviceFingerprint('user-1', 'fp-1');

    expect(flagsRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        type: FraudFlagType.MULTIPLE_ACCOUNTS_SAME_DEVICE,
        userId: 'user-1',
        relatedUserId: 'user-2',
        severity: FraudFlagSeverity.MEDIUM,
      }),
    );
  });

  it('escalates to HIGH severity when the fingerprint is shared across more than 2 other users', async () => {
    const { service, flagsRepo } = buildService({
      devicesRepo: {
        findOne: jest.fn().mockResolvedValue(null),
        find: jest.fn().mockResolvedValue([
          { userId: 'user-1', fingerprint: 'fp-1' },
          { userId: 'user-2', fingerprint: 'fp-1' },
          { userId: 'user-3', fingerprint: 'fp-1' },
          { userId: 'user-4', fingerprint: 'fp-1' },
        ]),
      },
    });

    await service.recordDeviceFingerprint('user-1', 'fp-1');

    expect(flagsRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ severity: FraudFlagSeverity.HIGH }),
    );
  });

  it('does not count the user\'s own other device rows as "other users"', async () => {
    const { service, flagsRepo } = buildService({
      devicesRepo: {
        findOne: jest.fn().mockResolvedValue(null),
        // Same user, same fingerprint recorded twice (e.g. re-login) — must not self-flag.
        find: jest.fn().mockResolvedValue([
          { userId: 'user-1', fingerprint: 'fp-1' },
          { userId: 'user-1', fingerprint: 'fp-1' },
        ]),
      },
    });

    await service.recordDeviceFingerprint('user-1', 'fp-1');

    expect(flagsRepo.save).not.toHaveBeenCalled();
  });
});

describe('FraudService.checkGpsSpoof', () => {
  it('does nothing on a driver\'s first location update (no previous point to compare)', async () => {
    const { service, flagsRepo } = buildService();
    await service.checkGpsSpoof('driver-1', null, { lat: 6.5, lng: 3.4, at: new Date() });
    expect(flagsRepo.save).not.toHaveBeenCalled();
  });

  it('does not flag a plausible driving speed', async () => {
    const { service, flagsRepo } = buildService();
    const t0 = new Date('2026-01-01T00:00:00Z');
    const t1 = new Date('2026-01-01T00:05:00Z'); // 5 minutes later
    // ~0.09 degrees latitude ≈ 10km — a plausible 120 km/h over 5 minutes.
    await service.checkGpsSpoof(
      'driver-1',
      { lat: 6.5, lng: 3.4, at: t0 },
      { lat: 6.59, lng: 3.4, at: t1 },
    );
    expect(flagsRepo.save).not.toHaveBeenCalled();
  });

  it('flags an implied speed above the impossible-speed threshold', async () => {
    const { service, flagsRepo } = buildService();
    const t0 = new Date('2026-01-01T00:00:00Z');
    const t1 = new Date('2026-01-01T00:01:00Z'); // 1 minute later
    // ~1 degree latitude ≈ 111km in 1 minute ≈ 6,660 km/h — nowhere close to plausible.
    await service.checkGpsSpoof(
      'driver-1',
      { lat: 6.5, lng: 3.4, at: t0 },
      { lat: 7.5, lng: 3.4, at: t1 },
    );
    expect(flagsRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ type: FraudFlagType.GPS_SPOOF, userId: 'driver-1', severity: FraudFlagSeverity.HIGH }),
    );
  });

  it('does not flag (and does not divide by zero) when the two updates share the same or an earlier timestamp', async () => {
    const { service, flagsRepo } = buildService();
    const t0 = new Date('2026-01-01T00:00:00Z');
    await service.checkGpsSpoof(
      'driver-1',
      { lat: 6.5, lng: 3.4, at: t0 },
      { lat: 7.5, lng: 3.4, at: t0 }, // same instant
    );
    expect(flagsRepo.save).not.toHaveBeenCalled();
  });
});

describe('FraudService.checkReferralAbuse', () => {
  it('does not flag when referrer and referee share no device fingerprint', async () => {
    const { service, flagsRepo } = buildService({
      devicesRepo: {
        find: jest
          .fn()
          .mockResolvedValueOnce([{ userId: 'referrer-1', fingerprint: 'fp-a' }])
          .mockResolvedValueOnce([{ userId: 'referee-1', fingerprint: 'fp-b' }]),
      },
    });

    await service.checkReferralAbuse('referrer-1', 'referee-1');

    expect(flagsRepo.save).not.toHaveBeenCalled();
  });

  it('flags referral abuse when referrer and referee share a device fingerprint', async () => {
    const { service, flagsRepo } = buildService({
      devicesRepo: {
        find: jest
          .fn()
          .mockResolvedValueOnce([{ userId: 'referrer-1', fingerprint: 'fp-shared' }])
          .mockResolvedValueOnce([{ userId: 'referee-1', fingerprint: 'fp-shared' }]),
      },
    });

    await service.checkReferralAbuse('referrer-1', 'referee-1');

    expect(flagsRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        type: FraudFlagType.REFERRAL_ABUSE,
        userId: 'referee-1',
        relatedUserId: 'referrer-1',
        severity: FraudFlagSeverity.HIGH,
      }),
    );
  });
});

describe('FraudService.reviewFlag', () => {
  it('updates status, reviewer, and notes on an existing flag', async () => {
    const flag = { id: 'flag-1', status: FraudFlagStatus.OPEN, reviewedBy: null, reviewNotes: null };
    const { service, flagsRepo } = buildService({
      flagsRepo: { findOne: jest.fn().mockResolvedValue(flag) },
    });

    const result = await service.reviewFlag('flag-1', 'admin-1', FraudFlagStatus.DISMISSED, 'False positive');

    expect(result.status).toBe(FraudFlagStatus.DISMISSED);
    expect(result.reviewedBy).toBe('admin-1');
    expect(result.reviewNotes).toBe('False positive');
  });

  it('throws when the flag does not exist', async () => {
    const { service } = buildService({ flagsRepo: { findOne: jest.fn().mockResolvedValue(null) } });
    await expect(service.reviewFlag('missing', 'admin-1', FraudFlagStatus.REVIEWED)).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('FraudService.listFlags', () => {
  function fakeQueryBuilder(result: [any[], number]) {
    const qb: any = {
      orderBy: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue(result),
    };
    return qb;
  }

  it('applies default pagination (page 1, pageSize 50) when none is given', async () => {
    const qb = fakeQueryBuilder([[], 0]);
    const { service } = buildService({ flagsRepo: { createQueryBuilder: jest.fn(() => qb) } });

    const result = await service.listFlags({});

    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(50);
    expect(qb.skip).toHaveBeenCalledWith(0);
    expect(qb.take).toHaveBeenCalledWith(50);
  });

  it('caps pageSize at 200 even if a larger value is requested', async () => {
    const qb = fakeQueryBuilder([[], 0]);
    const { service } = buildService({ flagsRepo: { createQueryBuilder: jest.fn(() => qb) } });

    const result = await service.listFlags({ pageSize: 10_000 });

    expect(result.pageSize).toBe(200);
    expect(qb.take).toHaveBeenCalledWith(200);
  });

  it('applies type/status/userId filters only when provided', async () => {
    const qb = fakeQueryBuilder([[], 0]);
    const { service } = buildService({ flagsRepo: { createQueryBuilder: jest.fn(() => qb) } });

    await service.listFlags({ type: FraudFlagType.GPS_SPOOF, status: FraudFlagStatus.OPEN, userId: 'user-1' });

    expect(qb.andWhere).toHaveBeenCalledWith('flag.type = :type', { type: FraudFlagType.GPS_SPOOF });
    expect(qb.andWhere).toHaveBeenCalledWith('flag.status = :status', { status: FraudFlagStatus.OPEN });
    expect(qb.andWhere).toHaveBeenCalledWith('flag.userId = :userId', { userId: 'user-1' });
  });

  it('applies no filters when none are provided', async () => {
    const qb = fakeQueryBuilder([[], 0]);
    const { service } = buildService({ flagsRepo: { createQueryBuilder: jest.fn(() => qb) } });

    await service.listFlags({});

    expect(qb.andWhere).not.toHaveBeenCalled();
  });
});
