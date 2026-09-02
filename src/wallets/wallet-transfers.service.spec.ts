import { BadRequestException, ConflictException } from '@nestjs/common';
import { WalletTransfersService } from './wallet-transfers.service';
import { WalletTransferStatus } from './entities/wallet-transfer-request.entity';

function fakeUser(overrides: Partial<any> = {}) {
  return { id: 'sender-1', email: 'sender@example.com', firstName: 'Sender', lastName: 'One', phone: '+2348011110000', isPhoneVerified: true, ...overrides };
}

function build(overrides: { existingPending?: any; user?: any } = {}) {
  const transferRequestsRepo = { findOne: jest.fn().mockResolvedValue(overrides.existingPending ?? null), save: jest.fn(async (d: any) => ({ id: 'request-1', expiresAt: new Date(Date.now() + 600_000), ...d })), create: jest.fn((d) => d) } as any;
  const txRepo = { find: jest.fn().mockResolvedValue([]) } as any;
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

  const service = new WalletTransfersService(transferRequestsRepo, txRepo, walletsService, usersService, otpService, settingsService);
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
