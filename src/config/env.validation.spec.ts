import {
  assertProductionDoesNotAutoSynchronizeSchema,
  assertProductionDoesNotForceDevOtp,
} from './env.validation';

describe('assertProductionDoesNotAutoSynchronizeSchema()', () => {
  it('does nothing outside production, even with synchronize on', () => {
    expect(() => assertProductionDoesNotAutoSynchronizeSchema('development', true)).not.toThrow();
    expect(() => assertProductionDoesNotAutoSynchronizeSchema('test', true)).not.toThrow();
  });

  it('does nothing in production when synchronize is off', () => {
    expect(() => assertProductionDoesNotAutoSynchronizeSchema('production', false)).not.toThrow();
  });

  it('refuses to boot in production when synchronize is on (including via the default-true fallback)', () => {
    expect(() => assertProductionDoesNotAutoSynchronizeSchema('production', true)).toThrow(
      /DB_SYNCHRONIZE/,
    );
  });
});

describe('assertProductionDoesNotForceDevOtp()', () => {
  it('does nothing outside production, even with the dev-OTP override on', () => {
    expect(() => assertProductionDoesNotForceDevOtp('development', true)).not.toThrow();
    expect(() => assertProductionDoesNotForceDevOtp('test', true)).not.toThrow();
  });

  it('does nothing in production when the dev-OTP override is off', () => {
    expect(() => assertProductionDoesNotForceDevOtp('production', false)).not.toThrow();
  });

  it('refuses to boot in production when the dev-OTP override is on - it hands out a valid OTP for any phone number', () => {
    expect(() => assertProductionDoesNotForceDevOtp('production', true)).toThrow(
      /OTP_FORCE_DEV_CODE/,
    );
  });
});
