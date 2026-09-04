import { BadRequestException } from '@nestjs/common';
import { SplitFareService } from './split-fare.service';
import { SplitFareStatus } from './entities/split-fare-request.entity';
import { SplitParticipantStatus } from './entities/split-fare-participant.entity';

function fakeRequest(overrides: Record<string, any> = {}) {
  return {
    id: 'split-1',
    rideId: 'ride-1',
    initiatorId: 'initiator-1',
    totalAmount: '1000.00',
    status: SplitFareStatus.PENDING,
    expiresAt: new Date(Date.now() + 3600_000),
    participants: [
      { id: 'p1', userId: 'participant-1', amountOwed: '500.00', status: SplitParticipantStatus.PENDING },
    ],
    ...overrides,
  };
}

function build(overrides: Record<string, any> = {}) {
  const requestsRepo = {
    findOne: jest.fn().mockResolvedValue(fakeRequest()),
    find: jest.fn().mockResolvedValue([]),
    save: jest.fn(async (r: any) => r),
    create: jest.fn((d: any) => d),
    createQueryBuilder: jest.fn(() => ({
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 1 }),
    })),
    ...overrides.requestsRepo,
  };
  const participantsRepo = { save: jest.fn(async (d: any) => d), create: jest.fn((d: any) => d) };
  const ridesRepo = {
    findOne: jest.fn().mockResolvedValue({ id: 'ride-1', passengerId: 'initiator-1', totalFare: '1000.00' }),
  };
  const usersService = {
    findByPhone: jest.fn().mockResolvedValue({ id: 'participant-1', firstName: 'P', lastName: 'One' }),
  };
  const walletsService = {
    getByUserId: jest.fn().mockResolvedValue({ id: 'wallet-1', balance: '5000.00' }),
    debit: jest.fn().mockResolvedValue(undefined),
    credit: jest.fn().mockResolvedValue(undefined),
  };
  const settingsService = { getNumber: jest.fn().mockImplementation((_key, fallback) => Promise.resolve(fallback)), ...overrides.settingsService };
  const events = { emit: jest.fn() };

  const service = new SplitFareService(
    requestsRepo as any,
    participantsRepo as any,
    ridesRepo as any,
    usersService as any,
    walletsService as any,
    settingsService as any,
    events as any,
  );

  return { service, requestsRepo, participantsRepo, walletsService, settingsService, events };
}

describe('SplitFareService.create() - sets expiresAt', () => {
  it('sets expiresAt using the default 48-hour window when nothing is configured', async () => {
    const { service, requestsRepo } = build({
      requestsRepo: { findOne: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(fakeRequest()) },
    });
    const before = Date.now();

    await service.create('ride-1', 'initiator-1', { participantPhones: ['+2348011110000'] });

    const savedArg = requestsRepo.create.mock.calls[0][0];
    const expiresAtMs = savedArg.expiresAt.getTime();
    expect(expiresAtMs).toBeGreaterThanOrEqual(before + 48 * 60 * 60 * 1000 - 1000);
    expect(expiresAtMs).toBeLessThanOrEqual(before + 48 * 60 * 60 * 1000 + 5000);
  });

  it('respects an admin-configured expiry window instead of the hardcoded default', async () => {
    const { service, requestsRepo } = build({
      requestsRepo: { findOne: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(fakeRequest()) },
      settingsService: { getNumber: jest.fn().mockResolvedValue(60) }, // 60 minutes
    });
    const before = Date.now();

    await service.create('ride-1', 'initiator-1', { participantPhones: ['+2348011110000'] });

    const expiresAtMs = requestsRepo.create.mock.calls[0][0].expiresAt.getTime();
    expect(expiresAtMs).toBeGreaterThanOrEqual(before + 60 * 60 * 1000 - 1000);
    expect(expiresAtMs).toBeLessThanOrEqual(before + 60 * 60 * 1000 + 5000);
  });
});

describe('SplitFareService.payShare() - refuses payment once expired', () => {
  it('refuses to accept a payment for an EXPIRED request', async () => {
    const { service, walletsService } = build({
      requestsRepo: { findOne: jest.fn().mockResolvedValue(fakeRequest({ status: SplitFareStatus.EXPIRED })) },
    });

    await expect(service.payShare('ride-1', 'participant-1')).rejects.toThrow(BadRequestException);
    expect(walletsService.debit).not.toHaveBeenCalled();
  });

  it('still accepts a payment for a PENDING (not yet expired) request', async () => {
    const { service, walletsService } = build();

    await service.payShare('ride-1', 'participant-1');

    expect(walletsService.debit).toHaveBeenCalled();
  });
});

describe('SplitFareService.expireStaleRequests()', () => {
  it('expires a PENDING request whose expiresAt has passed, and notifies the initiator', async () => {
    const staleRequest = fakeRequest({ expiresAt: new Date(Date.now() - 1000) });
    const { service, requestsRepo, events } = build({
      requestsRepo: { find: jest.fn().mockResolvedValue([staleRequest]) },
    });

    await service.expireStaleRequests();

    const qb = requestsRepo.createQueryBuilder.mock.results[0].value;
    expect(qb.execute).toHaveBeenCalled();
    expect(events.emit).toHaveBeenCalledWith('split_fare.expired', { initiatorId: 'initiator-1', rideId: 'ride-1' });
  });

  it('never touches a PENDING request whose expiresAt has not passed yet', async () => {
    const freshRequest = fakeRequest({ expiresAt: new Date(Date.now() + 3600_000) });
    const { service, requestsRepo, events } = build({
      requestsRepo: { find: jest.fn().mockResolvedValue([freshRequest]) },
    });

    await service.expireStaleRequests();

    expect(requestsRepo.createQueryBuilder).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('never touches a request with no expiresAt at all (pre-existing rows from before this feature)', async () => {
    const noExpiryRequest = fakeRequest({ expiresAt: null });
    const { service, requestsRepo } = build({
      requestsRepo: { find: jest.fn().mockResolvedValue([noExpiryRequest]) },
    });

    await service.expireStaleRequests();

    expect(requestsRepo.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('does nothing at all when there is nothing stale', async () => {
    const { service, requestsRepo } = build({ requestsRepo: { find: jest.fn().mockResolvedValue([]) } });

    await expect(service.expireStaleRequests()).resolves.toBeUndefined();
    expect(requestsRepo.createQueryBuilder).not.toHaveBeenCalled();
  });
});
