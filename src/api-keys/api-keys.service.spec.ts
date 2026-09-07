import { NotFoundException } from '@nestjs/common';
import { ApiKeysService } from './api-keys.service';

function fakeApiKey(overrides: Record<string, any> = {}) {
  return {
    id: 'key-1',
    name: 'Partner Integration',
    hashedKey: 'old-hash',
    keyPrefix: 'rk_oldpref',
    scopes: [],
    isActive: true,
    lastUsedAt: null,
    expiresAt: null,
    ...overrides,
  };
}

function build(overrides: Record<string, any> = {}) {
  const repo = {
    save: jest.fn(async (d: any) => ({ id: 'key-1', ...d })),
    create: jest.fn((d: any) => d),
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(fakeApiKey()),
    update: jest.fn().mockResolvedValue(undefined),
    ...overrides.repo,
  };

  const service = new ApiKeysService(repo as any);
  return { service, repo };
}

describe('ApiKeysService.create() - expiresAt', () => {
  it('persists an expiry date when one is given', async () => {
    const { service, repo } = build();
    await service.create({ name: 'Test key', expiresAt: '2027-01-01T00:00:00.000Z' });
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ expiresAt: new Date('2027-01-01T00:00:00.000Z') }),
    );
  });

  it('defaults to no expiry (valid indefinitely) when none is given', async () => {
    const { service, repo } = build();
    await service.create({ name: 'Test key' });
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ expiresAt: null }));
  });
});

describe('ApiKeysService.validate() - expiry enforcement', () => {
  it('accepts a key with no expiry set', async () => {
    const { service } = build({ repo: { findOne: jest.fn().mockResolvedValue(fakeApiKey({ expiresAt: null })) } });
    const result = await service.validate('rk_whatever');
    expect(result).not.toBeNull();
  });

  it('accepts a key whose expiry is in the future', async () => {
    const future = new Date(Date.now() + 86_400_000);
    const { service } = build({ repo: { findOne: jest.fn().mockResolvedValue(fakeApiKey({ expiresAt: future })) } });
    const result = await service.validate('rk_whatever');
    expect(result).not.toBeNull();
  });

  it(
    'rejects (returns null, not a distinct error) a key whose expiry has passed - the dashboard already ' +
      'shows an "Expired" badge for this; it must actually stop authenticating, not just display as expired',
    async () => {
      const past = new Date(Date.now() - 86_400_000);
      const { service, repo } = build({
        repo: { findOne: jest.fn().mockResolvedValue(fakeApiKey({ expiresAt: past })) },
      });

      const result = await service.validate('rk_whatever');

      expect(result).toBeNull();
      expect(repo.save).not.toHaveBeenCalled(); // no lastUsedAt bump for a rejected key
    },
  );
});

describe('ApiKeysService.rotate()', () => {
  it('generates a new secret while keeping name, scopes, and expiresAt unchanged', async () => {
    const existing = fakeApiKey({ name: 'Partner Integration', scopes: ['rides:read'], expiresAt: null });
    const { service, repo } = build({ repo: { findOne: jest.fn().mockResolvedValue(existing) } });

    const { apiKey, rawKey } = await service.rotate('key-1');

    expect(rawKey).toMatch(/^rk_[0-9a-f]+$/);
    expect(apiKey.name).toBe('Partner Integration');
    expect(apiKey.scopes).toEqual(['rides:read']);
  });

  it('actually changes the stored hash - the old raw key must stop working after rotation', async () => {
    const existing = fakeApiKey({ hashedKey: 'old-hash', keyPrefix: 'rk_oldpref' });
    const { service, repo } = build({ repo: { findOne: jest.fn().mockResolvedValue(existing) } });

    await service.rotate('key-1');

    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        hashedKey: expect.not.stringMatching('old-hash'),
        keyPrefix: expect.not.stringMatching('rk_oldpref'),
      }),
    );
  });

  it('resets lastUsedAt to null - it has not been used yet under the new secret', async () => {
    const existing = fakeApiKey({ lastUsedAt: new Date('2026-01-01') });
    const { service, repo } = build({ repo: { findOne: jest.fn().mockResolvedValue(existing) } });

    await service.rotate('key-1');

    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ lastUsedAt: null }));
  });

  it('returns the raw key exactly once, same contract as create()', async () => {
    const { service } = build();
    const result = await service.rotate('key-1');
    expect(typeof result.rawKey).toBe('string');
    expect(result.apiKey).not.toHaveProperty('rawKey');
  });

  it('throws NotFoundException for a key that does not exist', async () => {
    const { service } = build({ repo: { findOne: jest.fn().mockResolvedValue(null) } });
    await expect(service.rotate('missing')).rejects.toThrow(NotFoundException);
  });
});
