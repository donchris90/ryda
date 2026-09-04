import { FraudService } from './fraud.service';
import { FraudFlagType, FraudFlagSeverity } from './entities/fraud-flag.entity';

function buildService(overrides: Record<string, any> = {}) {
  const devicesRepo = {
    findOne: jest.fn().mockResolvedValue(null),
    count: jest.fn().mockResolvedValue(0),
    create: jest.fn((d: any) => d),
    save: jest.fn(async (d: any) => d),
    find: jest.fn().mockResolvedValue([]),
    ...overrides.devicesRepo,
  };
  const flagsRepo = {
    create: jest.fn((d: any) => d),
    save: jest.fn(async (d: any) => d),
    find: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
    ...overrides.flagsRepo,
  };

  const service = new FraudService(devicesRepo as any, flagsRepo as any);
  return { service, devicesRepo, flagsRepo };
}

describe('FraudService.recordDeviceFingerprint() - new-device detection', () => {
  it("does not treat a user's very first-ever login as a new-device signal", async () => {
    const { service, devicesRepo, flagsRepo } = buildService({
      devicesRepo: { findOne: jest.fn().mockResolvedValue(null), count: jest.fn().mockResolvedValue(0) },
    });

    const result = await service.recordDeviceFingerprint('user-1', 'fp-1', '1.2.3.4');

    expect(result.isNewDevice).toBe(false);
    expect(flagsRepo.save).not.toHaveBeenCalled();
    expect(devicesRepo.save).toHaveBeenCalled(); // the device is still recorded either way
  });

  it('flags and reports a new device when the user already has at least one other device on file', async () => {
    const { service, flagsRepo } = buildService({
      devicesRepo: { findOne: jest.fn().mockResolvedValue(null), count: jest.fn().mockResolvedValue(1) },
    });

    const result = await service.recordDeviceFingerprint('user-1', 'fp-2', '1.2.3.4');

    expect(result.isNewDevice).toBe(true);
    expect(flagsRepo.save).toHaveBeenCalledWith(expect.objectContaining({ type: FraudFlagType.NEW_DEVICE_LOGIN, userId: 'user-1' }));
  });

  it('does not re-flag a device the user has already logged in from before', async () => {
    const { service, flagsRepo } = buildService({
      devicesRepo: {
        findOne: jest.fn().mockResolvedValue({ id: 'device-1', userId: 'user-1', fingerprint: 'fp-known' }),
        count: jest.fn().mockResolvedValue(2),
      },
    });

    const result = await service.recordDeviceFingerprint('user-1', 'fp-known', '1.2.3.4');

    expect(result.isNewDevice).toBe(false);
    expect(flagsRepo.save).not.toHaveBeenCalled();
  });

  it('updates the stored IP for an already-known device rather than duplicating the record', async () => {
    const existing = { id: 'device-1', userId: 'user-1', fingerprint: 'fp-known', ipAddress: 'old-ip' };
    const { service, devicesRepo } = buildService({
      devicesRepo: { findOne: jest.fn().mockResolvedValue(existing), count: jest.fn().mockResolvedValue(1) },
    });

    await service.recordDeviceFingerprint('user-1', 'fp-known', 'new-ip');

    expect(devicesRepo.create).not.toHaveBeenCalled();
    expect(devicesRepo.save).toHaveBeenCalledWith(expect.objectContaining({ ipAddress: 'new-ip' }));
  });

  it('is a no-op (no device saved, no flags) when no fingerprint is supplied', async () => {
    const { service, devicesRepo, flagsRepo } = buildService();

    const result = await service.recordDeviceFingerprint('user-1', '');

    expect(result.isNewDevice).toBe(false);
    expect(devicesRepo.save).not.toHaveBeenCalled();
    expect(flagsRepo.save).not.toHaveBeenCalled();
  });
});

describe('FraudService.recordDeviceFingerprint() - multi-account sharing (independent of new-device status)', () => {
  it('flags MULTIPLE_ACCOUNTS_SAME_DEVICE when the fingerprint is already used by a different account', async () => {
    const { service, flagsRepo } = buildService({
      devicesRepo: {
        findOne: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
        find: jest.fn().mockResolvedValue([
          { userId: 'user-1', fingerprint: 'fp-shared' },
          { userId: 'user-2', fingerprint: 'fp-shared' },
        ]),
      },
    });

    await service.recordDeviceFingerprint('user-1', 'fp-shared', '1.2.3.4');

    expect(flagsRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ type: FraudFlagType.MULTIPLE_ACCOUNTS_SAME_DEVICE, userId: 'user-1', relatedUserId: 'user-2' }),
    );
  });

  it('escalates to HIGH severity when more than two other accounts share the device', async () => {
    const { service, flagsRepo } = buildService({
      devicesRepo: {
        findOne: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
        find: jest.fn().mockResolvedValue([
          { userId: 'user-1', fingerprint: 'fp-shared' },
          { userId: 'user-2', fingerprint: 'fp-shared' },
          { userId: 'user-3', fingerprint: 'fp-shared' },
          { userId: 'user-4', fingerprint: 'fp-shared' },
        ]),
      },
    });

    await service.recordDeviceFingerprint('user-1', 'fp-shared', '1.2.3.4');

    const call = flagsRepo.save.mock.calls.find((c: any[]) => c[0].type === FraudFlagType.MULTIPLE_ACCOUNTS_SAME_DEVICE);
    expect(call[0].severity).toBe('high');
  });

  it('raises both a new-device flag and a multi-account flag when both conditions are true at once', async () => {
    const { service, flagsRepo } = buildService({
      devicesRepo: {
        findOne: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(1),
        find: jest.fn().mockResolvedValue([
          { userId: 'user-1', fingerprint: 'fp-shared' },
          { userId: 'user-2', fingerprint: 'fp-shared' },
        ]),
      },
    });

    const result = await service.recordDeviceFingerprint('user-1', 'fp-shared', '1.2.3.4');

    expect(result.isNewDevice).toBe(true);
    const types = flagsRepo.save.mock.calls.map((c: any[]) => c[0].type);
    expect(types).toEqual(expect.arrayContaining([FraudFlagType.NEW_DEVICE_LOGIN, FraudFlagType.MULTIPLE_ACCOUNTS_SAME_DEVICE]));
  });
});

describe('FraudService.checkPaymentFailurePattern()', () => {
  it('does not flag a single failed payment - one decline is common and unremarkable', async () => {
    const { service, flagsRepo } = buildService();

    await service.checkPaymentFailurePattern('user-1', 1);

    expect(flagsRepo.save).not.toHaveBeenCalled();
  });

  it('does not flag two failures either - the threshold is deliberately not hair-trigger', async () => {
    const { service, flagsRepo } = buildService();

    await service.checkPaymentFailurePattern('user-1', 2);

    expect(flagsRepo.save).not.toHaveBeenCalled();
  });

  it('flags at MEDIUM severity once three failures cluster together', async () => {
    const { service, flagsRepo } = buildService();

    await service.checkPaymentFailurePattern('user-1', 3);

    expect(flagsRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ type: FraudFlagType.REPEATED_PAYMENT_FAILURES, userId: 'user-1', severity: FraudFlagSeverity.MEDIUM }),
    );
  });

  it('escalates to HIGH severity at five or more failures - the classic card-testing volume', async () => {
    const { service, flagsRepo } = buildService();

    await service.checkPaymentFailurePattern('user-1', 5);

    expect(flagsRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ type: FraudFlagType.REPEATED_PAYMENT_FAILURES, severity: FraudFlagSeverity.HIGH }),
    );
  });
});

describe('FraudService.checkMultipleCardsAdded()', () => {
  it('does not flag adding one or two cards - ordinary account setup', async () => {
    const { service, flagsRepo } = buildService();

    await service.checkMultipleCardsAdded('user-1', 2);

    expect(flagsRepo.save).not.toHaveBeenCalled();
  });

  it('flags at MEDIUM severity once three distinct cards are added in the same window', async () => {
    const { service, flagsRepo } = buildService();

    await service.checkMultipleCardsAdded('user-1', 3);

    expect(flagsRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ type: FraudFlagType.MULTIPLE_CARDS_ADDED, userId: 'user-1', severity: FraudFlagSeverity.MEDIUM }),
    );
  });

  it('escalates to HIGH severity at five or more cards', async () => {
    const { service, flagsRepo } = buildService();

    await service.checkMultipleCardsAdded('user-1', 6);

    expect(flagsRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ type: FraudFlagType.MULTIPLE_CARDS_ADDED, severity: FraudFlagSeverity.HIGH }),
    );
  });
});

describe('FraudService.checkPromoRedemptionPattern()', () => {
  it('does not flag redeeming a few promos over time - ordinary usage', async () => {
    const { service, flagsRepo } = buildService();

    await service.checkPromoRedemptionPattern('user-1', 3);

    expect(flagsRepo.save).not.toHaveBeenCalled();
  });

  it('flags at MEDIUM severity once four redemptions cluster in the window', async () => {
    const { service, flagsRepo } = buildService();

    await service.checkPromoRedemptionPattern('user-1', 4);

    expect(flagsRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ type: FraudFlagType.REPEATED_PROMO_REDEMPTION, userId: 'user-1', severity: FraudFlagSeverity.MEDIUM }),
    );
  });

  it('escalates to HIGH severity at eight or more redemptions', async () => {
    const { service, flagsRepo } = buildService();

    await service.checkPromoRedemptionPattern('user-1', 8);

    expect(flagsRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ type: FraudFlagType.REPEATED_PROMO_REDEMPTION, severity: FraudFlagSeverity.HIGH }),
    );
  });
});

describe('FraudService.checkRepeatedCancellations()', () => {
  it('does not flag a few cancellations - ordinary rider behavior (driver ran late, plans changed)', async () => {
    const { service, flagsRepo } = buildService();

    await service.checkRepeatedCancellations('user-1', 3);

    expect(flagsRepo.save).not.toHaveBeenCalled();
  });

  it('flags at MEDIUM severity once four cancellations cluster in the window', async () => {
    const { service, flagsRepo } = buildService();

    await service.checkRepeatedCancellations('user-1', 4);

    expect(flagsRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ type: FraudFlagType.REPEATED_CANCELLATIONS, userId: 'user-1', severity: FraudFlagSeverity.MEDIUM }),
    );
  });

  it('escalates to HIGH severity at eight or more cancellations', async () => {
    const { service, flagsRepo } = buildService();

    await service.checkRepeatedCancellations('user-1', 9);

    expect(flagsRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ type: FraudFlagType.REPEATED_CANCELLATIONS, severity: FraudFlagSeverity.HIGH }),
    );
  });
});

describe('FraudService.checkExcessiveRefunds()', () => {
  it('does not flag one or two refunds - refunds are a normal, healthy part of the marketplace', async () => {
    const { service, flagsRepo } = buildService();

    await service.checkExcessiveRefunds('user-1', 2);

    expect(flagsRepo.save).not.toHaveBeenCalled();
  });

  it('flags at MEDIUM severity once three refunds cluster in the window', async () => {
    const { service, flagsRepo } = buildService();

    await service.checkExcessiveRefunds('user-1', 3);

    expect(flagsRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ type: FraudFlagType.EXCESSIVE_REFUNDS, userId: 'user-1', severity: FraudFlagSeverity.MEDIUM }),
    );
  });

  it('escalates to HIGH severity at six or more refunds', async () => {
    const { service, flagsRepo } = buildService();

    await service.checkExcessiveRefunds('user-1', 6);

    expect(flagsRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ type: FraudFlagType.EXCESSIVE_REFUNDS, severity: FraudFlagSeverity.HIGH }),
    );
  });
});

describe('FraudService.checkWalletVelocity()', () => {
  it('does not flag a handful of transfers - ordinary usage', async () => {
    const { service, flagsRepo } = buildService();

    await service.checkWalletVelocity('user-1', 4);

    expect(flagsRepo.save).not.toHaveBeenCalled();
  });

  it('flags at MEDIUM severity once five transfers cluster within the window', async () => {
    const { service, flagsRepo } = buildService();

    await service.checkWalletVelocity('user-1', 5);

    expect(flagsRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ type: FraudFlagType.UNUSUAL_WALLET_VELOCITY, userId: 'user-1', severity: FraudFlagSeverity.MEDIUM }),
    );
  });

  it('escalates to HIGH severity at ten or more transfers', async () => {
    const { service, flagsRepo } = buildService();

    await service.checkWalletVelocity('user-1', 10);

    expect(flagsRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ type: FraudFlagType.UNUSUAL_WALLET_VELOCITY, severity: FraudFlagSeverity.HIGH }),
    );
  });
});

describe('FraudService.checkChargebackHistory() - deliberately a lower bar than the other checks', () => {
  it('does not flag zero chargebacks', async () => {
    const { service, flagsRepo } = buildService();

    await service.checkChargebackHistory('user-1', 0);

    expect(flagsRepo.save).not.toHaveBeenCalled();
  });

  it('flags at MEDIUM severity for even a single resolved chargeback - unlike a failed payment, this is a completed dispute with real money already moved', async () => {
    const { service, flagsRepo } = buildService();

    await service.checkChargebackHistory('user-1', 1);

    expect(flagsRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ type: FraudFlagType.CHARGEBACK_HISTORY, userId: 'user-1', severity: FraudFlagSeverity.MEDIUM }),
    );
  });

  it('escalates to HIGH severity at two or more resolved chargebacks', async () => {
    const { service, flagsRepo } = buildService();

    await service.checkChargebackHistory('user-1', 2);

    expect(flagsRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ type: FraudFlagType.CHARGEBACK_HISTORY, severity: FraudFlagSeverity.HIGH }),
    );
  });
});

describe('FraudService.getSummary()', () => {
  it('counts high-severity open flags across both HIGH and CRITICAL severities', async () => {
    const countMock = jest.fn()
      .mockResolvedValueOnce(50) // total
      .mockResolvedValueOnce(20) // open
      .mockResolvedValueOnce(5) // escalated
      .mockResolvedValueOnce(8); // high-severity open (HIGH + CRITICAL combined)
    const { service } = buildService({ flagsRepo: { count: countMock } });

    const result = await service.getSummary();

    expect(result).toEqual({ totalFlags: 50, openCount: 20, escalatedCount: 5, highSeverityOpenCount: 8 });
    expect(countMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: [
          { status: 'open', severity: FraudFlagSeverity.HIGH },
          { status: 'open', severity: FraudFlagSeverity.CRITICAL },
        ],
      }),
    );
  });
});

describe('FraudService.listDevicesForUser()', () => {
  it("returns this user's own devices, most recently seen first", async () => {
    const devices = [{ id: 'd1', userId: 'user-1', fingerprint: 'fp-1' }];
    const { service, devicesRepo } = buildService({ devicesRepo: { find: jest.fn().mockResolvedValue(devices) } });

    const result = await service.listDevicesForUser('user-1');

    expect(result).toBe(devices);
    expect(devicesRepo.find).toHaveBeenCalledWith({ where: { userId: 'user-1' }, order: { lastSeenAt: 'DESC' } });
  });
});

describe('FraudService.findRelatedAccounts()', () => {
  it('includes another account sharing a device fingerprint', async () => {
    const { service, devicesRepo } = buildService({
      devicesRepo: {
        find: jest.fn()
          .mockResolvedValueOnce([{ userId: 'user-1', fingerprint: 'fp-shared' }]) // this user's own devices
          .mockResolvedValueOnce([
            { userId: 'user-1', fingerprint: 'fp-shared' },
            { userId: 'user-2', fingerprint: 'fp-shared' },
          ]), // everyone on that fingerprint
      },
    });

    const result = await service.findRelatedAccounts('user-1');

    expect(result).toEqual(['user-2']);
  });

  it("includes a flag's relatedUserId even with no shared device at all", async () => {
    const { service } = buildService({
      devicesRepo: { find: jest.fn().mockResolvedValue([]) },
      flagsRepo: {
        find: jest.fn().mockResolvedValue([{ userId: 'user-1', relatedUserId: 'user-9' }]),
      },
    });

    const result = await service.findRelatedAccounts('user-1');

    expect(result).toEqual(['user-9']);
  });

  it('never includes the user themselves, and de-duplicates accounts related through both signals', async () => {
    const { service } = buildService({
      devicesRepo: {
        find: jest.fn()
          .mockResolvedValueOnce([{ userId: 'user-1', fingerprint: 'fp-shared' }])
          .mockResolvedValueOnce([
            { userId: 'user-1', fingerprint: 'fp-shared' },
            { userId: 'user-2', fingerprint: 'fp-shared' },
          ]),
      },
      flagsRepo: {
        find: jest.fn().mockResolvedValue([{ userId: 'user-1', relatedUserId: 'user-2' }]),
      },
    });

    const result = await service.findRelatedAccounts('user-1');

    expect(result).toEqual(['user-2']);
  });

  it('returns an empty array when nothing connects this account to any other', async () => {
    const { service } = buildService({
      devicesRepo: { find: jest.fn().mockResolvedValue([]) },
      flagsRepo: { find: jest.fn().mockResolvedValue([]) },
    });

    expect(await service.findRelatedAccounts('user-1')).toEqual([]);
  });
});
