import { BadRequestException, ConflictException } from '@nestjs/common';
import { WalletTransfersService } from './wallet-transfers.service';
import { WalletTransferStatus } from './entities/wallet-transfer-request.entity';

function fakeUser(overrides: Partial<any> = {}) {
  return { id: 'sender-1', email: 'sender@example.com', firstName: 'Sender', lastName: 'One', phone: '+2348011110000', isPhoneVerified: true, ...overrides };
}

function build(overrides: { existingPending?: any; user?: any } = {}) {
  const transferRequestsRepo = { findOne: jest.fn().mockResolvedValue(overrides.existingPending ?? null), save: jest.fn(async (d: any) => ({ id: 'request-1', expiresAt: new Date(Date.now() + 600_000), ...d })), create: jest.fn((d) => d) } as any;
  const txRepo = { find: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) } as any;
  const walletsService = {
    getByUserId: jest.fn().mockResolvedValue({ id: 'wallet-1', balance: '10000.00' }),
  } as any;
  const usersService = {
    findById: jest.fn().mockResolvedValue(overrides.user ?? fakeUser()),
    findByPhone: jest.fn().mockResolvedValue({ id: 'recipient-1', firstName: 'Recipient', lastName: 'One', email: 'r@example.com', phone: '+2348022220000' }),
    findByEmail: jest.fn(),
  } as any;
  const otpService = { send: jest.fn().mockResolvedValue({ expiresInSeconds: 300 }) } as any;
  const settingsService = { getNumber: jest.fn().mockImplementation((_key, fallback) => Promise.resolve(fallback)) } as any;
  const fraudService = { checkWalletVelocity: jest.fn().mockResolvedValue(undefined) } as any;

  const service = new WalletTransfersService(transferRequestsRepo, txRepo, walletsService, usersService, otpService, settingsService, fraudService);
  return { service, transferRequestsRepo, otpService };
}

describe('WalletTransfersService.initiate() - duplicate pending request prevention', () => {
  it('rejects a second initiate while one is already pending and not yet expired - the real risk: OTP verification is scoped to (phone, purpose) only, not a specific transferRequestId, so a stray second pending request could otherwise be confirmed by the wrong OTP', async () => {
    const { service, otpService } = build({
      existingPending: { id: 'existing-1', status: WalletTransferStatus.PENDING, expiresAt: new Date(Date.now() + 60_000) },
    });

    await expect(
      service.initiate('sender-1', { recipientPhone: '+2348022220000', amount: 1000 } as any),
    ).rejects.toThrow(ConflictException);
    expect(otpService.send).not.toHaveBeenCalled();
  });

  it('allows a new initiate once the previous pending request has genuinely expired', async () => {
    const { service, otpService } = build({
      existingPending: { id: 'existing-1', status: WalletTransferStatus.PENDING, expiresAt: new Date(Date.now() - 1000) },
    });

    await expect(
      service.initiate('sender-1', { recipientPhone: '+2348022220000', amount: 1000 } as any),
    ).resolves.toBeDefined();
    expect(otpService.send).toHaveBeenCalled();
  });

  it('allows a new initiate when there is no pending request at all', async () => {
    const { service, otpService } = build({ existingPending: null });

    await expect(
      service.initiate('sender-1', { recipientPhone: '+2348022220000', amount: 1000 } as any),
    ).resolves.toBeDefined();
    expect(otpService.send).toHaveBeenCalled();
  });

  it('still enforces the phone-verification requirement before even checking for a pending duplicate', async () => {
    const { service } = build({ user: fakeUser({ isPhoneVerified: false }) });

    await expect(
      service.initiate('sender-1', { recipientPhone: '+2348022220000', amount: 1000 } as any),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('WalletTransfersService.expireStaleRequests() - proactive cleanup for abandoned requests', () => {
  function buildWithQueryBuilder(affected = 1) {
    const executeMock = jest.fn().mockResolvedValue({ affected });
    const qb = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      execute: executeMock,
    };
    const transferRequestsRepo = { createQueryBuilder: jest.fn().mockReturnValue(qb) } as any;
    const service = new WalletTransfersService(
      transferRequestsRepo, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
    );
    return { service, qb };
  }

  it('marks stale pending requests expired via a single bulk update, not one row at a time', async () => {
    const { service, qb } = buildWithQueryBuilder(3);

    await service.expireStaleRequests();

    expect(qb.set).toHaveBeenCalledWith({ status: WalletTransferStatus.EXPIRED });
    expect(qb.where).toHaveBeenCalledWith('status = :status', { status: WalletTransferStatus.PENDING });
  });

  it('does not throw or log anything alarming when nothing was actually stale', async () => {
    const { service } = buildWithQueryBuilder(0);

    await expect(service.expireStaleRequests()).resolves.toBeUndefined();
  });
});

describe('WalletTransfersService.confirm() - wallet-velocity detection', () => {
  function buildForConfirm(overrides: { txCount?: number; fraudService?: any } = {}) {
    const pendingRequest = {
      id: 'request-1',
      senderId: 'sender-1',
      recipientId: 'recipient-1',
      amount: '500.00',
      fee: '10.00',
      note: null,
      status: WalletTransferStatus.PENDING,
      expiresAt: new Date(Date.now() + 600_000),
    };
    const transferRequestsRepo = {
      findOne: jest.fn().mockResolvedValue(pendingRequest),
      save: jest.fn(async (d: any) => d),
    } as any;
    const txRepo = { find: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(overrides.txCount ?? 0) } as any;
    const walletsService = {
      getByUserId: jest.fn().mockResolvedValue({ id: 'wallet-sender', balance: '10000.00' }),
      transfer: jest.fn().mockResolvedValue({ senderWallet: { balance: '9490.00' }, recipientWallet: {} }),
    } as any;
    const usersService = {
      findById: jest.fn().mockResolvedValue({ id: 'sender-1', phone: '+2348011110000', firstName: 'Sender', lastName: 'One' }),
    } as any;
    const otpService = { verify: jest.fn().mockResolvedValue(undefined) } as any;
    const settingsService = { getNumber: jest.fn() } as any;
    const fraudService = { checkWalletVelocity: jest.fn().mockResolvedValue(undefined), ...overrides.fraudService };

    const service = new WalletTransfersService(transferRequestsRepo, txRepo, walletsService, usersService, otpService, settingsService, fraudService);
    return { service, txRepo, fraudService };
  }

  it('checks the velocity pattern (with the recent-transfer count) once a transfer genuinely completes', async () => {
    const { service, fraudService } = buildForConfirm({ txCount: 6 });

    await service.confirm('sender-1', { transferRequestId: 'request-1', otpCode: '123456' } as any);

    expect(fraudService.checkWalletVelocity).toHaveBeenCalledWith('sender-1', 6);
  });

  it('never breaks the transfer response if the fraud check itself fails', async () => {
    const { service } = buildForConfirm({
      fraudService: { checkWalletVelocity: jest.fn().mockRejectedValue(new Error('fraud service down')) },
    });

    await expect(
      service.confirm('sender-1', { transferRequestId: 'request-1', otpCode: '123456' } as any),
    ).resolves.toBeDefined();
  });
});
