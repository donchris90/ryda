import { BadRequestException } from '@nestjs/common';
import { OtpService } from './otp.service';
import { OtpPurpose } from './otp-code.entity';

function buildService(overrides: Record<string, any> = {}) {
  const otpRepo = {
    save: jest.fn(async (r: any) => r),
    create: jest.fn((r: any) => r),
    findOne: jest.fn(),
    ...overrides.otpRepo,
  };
  const config = {
    get: jest.fn((key: string) => {
      if (key === 'otp.length') return 6;
      if (key === 'otp.ttlSeconds') return 300;
      return undefined;
    }),
    ...overrides.config,
  };
  const africasTalking = {
    isConfigured: jest.fn().mockReturnValue(true),
    sendSms: jest.fn().mockResolvedValue({ success: true }),
    ...overrides.africasTalking,
  };

  const service = new OtpService(otpRepo as any, config as any, africasTalking as any);
  return { service, otpRepo, config, africasTalking };
}

describe('OtpService.send() - Africa\'s Talking wiring', () => {
  it('sends the OTP via Africa\'s Talking when configured, and does not leak the code in the response', async () => {
    const { service, africasTalking } = buildService();

    const result = await service.send('+2348012345678', OtpPurpose.PHONE_VERIFICATION);

    expect(africasTalking.sendSms).toHaveBeenCalledWith('+2348012345678', expect.stringContaining('verification code'));
    expect(result.delivered).toBe(true);
    // Once real delivery succeeds, the code must not also be readable
    // straight from this response - devOnlyCode is a fallback for when
    // SMS delivery genuinely didn't happen, not a convenience.
    expect(result.devOnlyCode).toBeNull();
  });

  it('falls back to returning the code directly when Africa\'s Talking is not configured, rather than silently losing it', async () => {
    const { service, africasTalking } = buildService({
      africasTalking: { isConfigured: jest.fn().mockReturnValue(false) },
    });

    const result = await service.send('+2348012345678', OtpPurpose.PHONE_VERIFICATION);

    expect(africasTalking.sendSms).not.toHaveBeenCalled();
    expect(result.delivered).toBe(false);
    expect(result.devOnlyCode).toEqual(expect.stringMatching(/^\d{6}$/));
  });

  it('falls back to returning the code directly when Africa\'s Talking rejects the send, not just when it is unconfigured', async () => {
    const { service } = buildService({
      africasTalking: { sendSms: jest.fn().mockResolvedValue({ success: false, error: 'Insufficient balance' }) },
    });

    const result = await service.send('+2348012345678', OtpPurpose.PHONE_VERIFICATION);

    expect(result.delivered).toBe(false);
    expect(result.devOnlyCode).toEqual(expect.stringMatching(/^\d{6}$/));
  });

  it('persists a record with the configured length and TTL', async () => {
    const { service, otpRepo } = buildService();

    await service.send('+2348012345678', OtpPurpose.WALLET_WITHDRAWAL);

    expect(otpRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ destination: '+2348012345678', purpose: OtpPurpose.WALLET_WITHDRAWAL, code: expect.stringMatching(/^\d{6}$/) }),
    );
  });
});

describe('OtpService.verify()', () => {
  function fakeOtpRecord(overrides: Record<string, any> = {}) {
    return {
      id: 'otp-1',
      destination: '+2348012345678',
      purpose: OtpPurpose.PHONE_VERIFICATION,
      code: '123456',
      isUsed: false,
      attemptCount: 0,
      expiresAt: new Date(Date.now() + 60_000),
      ...overrides,
    };
  }

  it('succeeds and marks the code used for a correct, unexpired, unused code', async () => {
    const record = fakeOtpRecord();
    const { service, otpRepo } = buildService({ otpRepo: { findOne: jest.fn().mockResolvedValue(record) } });

    await service.verify('+2348012345678', '123456', OtpPurpose.PHONE_VERIFICATION);

    expect(otpRepo.save).toHaveBeenCalledWith(expect.objectContaining({ isUsed: true }));
  });

  it('rejects an expired code', async () => {
    const record = fakeOtpRecord({ expiresAt: new Date(Date.now() - 1000) });
    const { service } = buildService({ otpRepo: { findOne: jest.fn().mockResolvedValue(record) } });

    await expect(service.verify('+2348012345678', '123456', OtpPurpose.PHONE_VERIFICATION)).rejects.toThrow(BadRequestException);
  });

  it('rejects a wrong code and increments the attempt count rather than leaving it unchanged', async () => {
    const record = fakeOtpRecord();
    const { service, otpRepo } = buildService({ otpRepo: { findOne: jest.fn().mockResolvedValue(record) } });

    await expect(service.verify('+2348012345678', '000000', OtpPurpose.PHONE_VERIFICATION)).rejects.toThrow(BadRequestException);

    expect(otpRepo.save).toHaveBeenCalledWith(expect.objectContaining({ attemptCount: 1 }));
  });

  it('rejects once the attempt limit has already been reached, even with the correct code', async () => {
    const record = fakeOtpRecord({ attemptCount: 5 });
    const { service } = buildService({ otpRepo: { findOne: jest.fn().mockResolvedValue(record) } });

    await expect(service.verify('+2348012345678', '123456', OtpPurpose.PHONE_VERIFICATION)).rejects.toThrow('Too many incorrect attempts — request a new code');
  });

  it('rejects when there is no pending OTP at all for this destination/purpose', async () => {
    const { service } = buildService({ otpRepo: { findOne: jest.fn().mockResolvedValue(null) } });

    await expect(service.verify('+2348012345678', '123456', OtpPurpose.PHONE_VERIFICATION)).rejects.toThrow(BadRequestException);
  });
});
