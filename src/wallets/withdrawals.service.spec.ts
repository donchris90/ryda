import { BadRequestException, ConflictException } from '@nestjs/common';
import { WithdrawalsService } from './withdrawals.service';
import { WithdrawalStatus } from './entities/withdrawal-request.entity';
import { RiskBand } from '../fraud/risk-engine.service';

function fakeUser(overrides: Partial<any> = {}) {
  return { id: 'user-1', phone: '+2348011110000', isPhoneVerified: true, ...overrides };
}

function build(overrides: { existingPending?: any; user?: any; riskEngineService?: any } = {}) {
  const bankAccountsRepo = { findOne: jest.fn().mockResolvedValue({ id: 'bank-1', userId: 'user-1', bankName: 'Test Bank', accountNumber: '0123456789', accountName: 'User One', paystackRecipientCode: 'RCP_1' }) } as any;
  const withdrawalsRepo = { findOne: jest.fn().mockResolvedValue(overrides.existingPending ?? null), save: jest.fn((d) => d), create: jest.fn((d) => d) } as any;
  const walletsService = { getByUserId: jest.fn().mockResolvedValue({ id: 'wallet-1', balance: '10000.00' }) } as any;
  const paystack = { isConfigured: jest.fn().mockReturnValue(true) } as any;
  const config = { get: jest.fn().mockReturnValue(500) } as any;
  const events = { emit: jest.fn() } as any;
  const usersService = { findById: jest.fn().mockResolvedValue(overrides.user ?? fakeUser()) } as any;
  const otpService = { send: jest.fn().mockResolvedValue({ expiresInSeconds: 300 }) } as any;
  const riskEngineService = overrides.riskEngineService ?? {
    assess: jest.fn().mockResolvedValue({ userId: 'user-1', score: 0, band: RiskBand.LOW, reasons: [] }),
  };
  const fraudService = { raiseFlag: jest.fn().mockResolvedValue(undefined) } as any;

  const service = new WithdrawalsService(
    bankAccountsRepo,
    withdrawalsRepo,
    walletsService,
    paystack,
    config,
    events,
    usersService,
    otpService,
    riskEngineService,
    fraudService,
  );
  return { service, withdrawalsRepo, otpService, riskEngineService, fraudService };
}

describe('WithdrawalsService.initiateWithdrawal() - duplicate pending request prevention', () => {
  it('rejects a second initiate while one is already pending and not yet expired - same reasoning as the identical transfer check: OTP verification is scoped to (phone, purpose), not a specific withdrawalRequestId', async () => {
    const { service, otpService } = build({
      existingPending: { id: 'existing-1', status: WithdrawalStatus.PENDING, expiresAt: new Date(Date.now() + 60_000) },
    });

    await expect(service.initiateWithdrawal('user-1', 'bank-1', 1000)).rejects.toThrow(ConflictException);
    expect(otpService.send).not.toHaveBeenCalled();
  });

  it('allows a new initiate once the previous pending request has genuinely expired', async () => {
    const { service, otpService } = build({
      existingPending: { id: 'existing-1', status: WithdrawalStatus.PENDING, expiresAt: new Date(Date.now() - 1000) },
    });

    await expect(service.initiateWithdrawal('user-1', 'bank-1', 1000)).resolves.toBeDefined();
    expect(otpService.send).toHaveBeenCalled();
  });

  it('allows a new initiate when there is no pending request at all', async () => {
    const { service, otpService } = build({ existingPending: null });

    await expect(service.initiateWithdrawal('user-1', 'bank-1', 1000)).resolves.toBeDefined();
    expect(otpService.send).toHaveBeenCalled();
  });

  it('still enforces the phone-verification requirement before even checking for a pending duplicate', async () => {
    const { service } = build({ user: fakeUser({ isPhoneVerified: false }) });

    await expect(service.initiateWithdrawal('user-1', 'bank-1', 1000)).rejects.toThrow(BadRequestException);
  });
});

describe('WithdrawalsService.initiateWithdrawal() - risk-based graduated response', () => {
  it('allows LOW-risk requests through untouched, with no flag raised', async () => {
    const { service, fraudService } = build({
      riskEngineService: { assess: jest.fn().mockResolvedValue({ userId: 'user-1', score: 5, band: RiskBand.LOW, reasons: [] }) },
    });

    await expect(service.initiateWithdrawal('user-1', 'bank-1', 1000)).resolves.toBeDefined();
    expect(fraudService.raiseFlag).not.toHaveBeenCalled();
  });

  it('allows MEDIUM-risk requests through untouched too - only HIGH and CRITICAL trigger a graduated response', async () => {
    const { service, fraudService } = build({
      riskEngineService: { assess: jest.fn().mockResolvedValue({ userId: 'user-1', score: 25, band: RiskBand.MEDIUM, reasons: [] }) },
    });

    await expect(service.initiateWithdrawal('user-1', 'bank-1', 1000)).resolves.toBeDefined();
    expect(fraudService.raiseFlag).not.toHaveBeenCalled();
  });

  it('allows a HIGH-risk request to proceed, but flags it for admin review', async () => {
    const { service, otpService, fraudService } = build({
      riskEngineService: { assess: jest.fn().mockResolvedValue({ userId: 'user-1', score: 60, band: RiskBand.HIGH, reasons: [] }) },
    });

    await expect(service.initiateWithdrawal('user-1', 'bank-1', 1000)).resolves.toBeDefined();
    expect(otpService.send).toHaveBeenCalled(); // still goes through the normal verification step
    expect(fraudService.raiseFlag).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'high_risk_withdrawal_attempt', userId: 'user-1', severity: 'high' }),
    );
  });

  it('blocks a CRITICAL-risk request outright - the only band that actually refuses the operation', async () => {
    const { service, otpService, fraudService } = build({
      riskEngineService: { assess: jest.fn().mockResolvedValue({ userId: 'user-1', score: 95, band: RiskBand.CRITICAL, reasons: [] }) },
    });

    await expect(service.initiateWithdrawal('user-1', 'bank-1', 1000)).rejects.toThrow(BadRequestException);
    expect(otpService.send).not.toHaveBeenCalled();
    expect(fraudService.raiseFlag).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'critical_risk_withdrawal_blocked', userId: 'user-1', severity: 'critical' }),
    );
  });

  it('a CRITICAL-risk block never touches the wallet balance or creates a withdrawal record', async () => {
    const { service, withdrawalsRepo } = build({
      riskEngineService: { assess: jest.fn().mockResolvedValue({ userId: 'user-1', score: 95, band: RiskBand.CRITICAL, reasons: [] }) },
    });

    await expect(service.initiateWithdrawal('user-1', 'bank-1', 1000)).rejects.toThrow(BadRequestException);
    expect(withdrawalsRepo.save).not.toHaveBeenCalled();
  });
});

describe('WithdrawalsService.expireStaleRequests() - proactive cleanup for abandoned requests', () => {
  function buildWithQueryBuilder(affected = 1) {
    const executeMock = jest.fn().mockResolvedValue({ affected });
    const qb = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      execute: executeMock,
    };
    const withdrawalsRepo = { createQueryBuilder: jest.fn().mockReturnValue(qb) } as any;
    const service = new WithdrawalsService(
      {} as any, withdrawalsRepo, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
    );
    return { service, qb };
  }

  it('marks stale pending withdrawal requests expired via a single bulk update', async () => {
    const { service, qb } = buildWithQueryBuilder(2);

    await service.expireStaleRequests();

    expect(qb.set).toHaveBeenCalledWith({ status: WithdrawalStatus.EXPIRED });
    expect(qb.where).toHaveBeenCalledWith('status = :status', { status: WithdrawalStatus.PENDING });
  });

  it('does not throw when nothing was actually stale', async () => {
    const { service } = buildWithQueryBuilder(0);

    await expect(service.expireStaleRequests()).resolves.toBeUndefined();
  });
});
