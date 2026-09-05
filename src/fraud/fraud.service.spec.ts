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

describe('FraudService.checkGpsSpoof() - false positives', () => {
  it('does nothing on a location update with no previous point to compare against - a brand-new session has nothing to imply a speed from', async () => {
    const { service, flagsRepo } = buildService();

    await service.checkGpsSpoof('driver-1', null, { lat: 6.5, lng: 3.3, at: new Date() });

    expect(flagsRepo.save).not.toHaveBeenCalled();
  });

  it('does not flag ordinary city driving speed', async () => {
    const { service, flagsRepo } = buildService();
    const t0 = new Date('2026-01-01T10:00:00Z');
    // ~6.6km in 10 minutes = ~40 km/h - unremarkable city traffic.
    const previous = { lat: 6.5244, lng: 3.3792, at: t0 };
    const next = { lat: 6.58, lng: 3.38, at: new Date(t0.getTime() + 10 * 60_000) };

    await service.checkGpsSpoof('driver-1', previous, next);

    expect(flagsRepo.save).not.toHaveBeenCalled();
  });

  it('does not flag a long trip covering real distance over a proportionally long time, even though the raw distance is large', async () => {
    const { service, flagsRepo } = buildService();
    const t0 = new Date('2026-01-01T08:00:00Z');
    // Lagos to Ibadan-ish distance (~120km) over 2 hours = 60 km/h -
    // a big number in isolation, but nothing suspicious once time is
    // accounted for. The check most needs to get this right: distance
    // alone is never the signal, implied speed is.
    const previous = { lat: 6.5244, lng: 3.3792, at: t0 };
    const next = { lat: 7.3775, lng: 3.947, at: new Date(t0.getTime() + 2 * 3_600_000) };

    await service.checkGpsSpoof('driver-1', previous, next);

    expect(flagsRepo.save).not.toHaveBeenCalled();
  });

  it('does not flag zero movement, no matter how the clocks compare', async () => {
    const { service, flagsRepo } = buildService();
    const t0 = new Date('2026-01-01T10:00:00Z');
    const point = { lat: 6.5244, lng: 3.3792 };

    await service.checkGpsSpoof('driver-1', { ...point, at: t0 }, { ...point, at: new Date(t0.getTime() + 1000) });

    expect(flagsRepo.save).not.toHaveBeenCalled();
  });

  it('does not flag (and does not divide by zero/negative) when the new update is not actually after the previous one - a re-delivered or out-of-order location ping, not spoofing', async () => {
    const { service, flagsRepo } = buildService();
    const t0 = new Date('2026-01-01T10:00:00Z');

    // Same timestamp (elapsedHours === 0)
    await service.checkGpsSpoof(
      'driver-1',
      { lat: 6.5244, lng: 3.3792, at: t0 },
      { lat: 6.6, lng: 3.4, at: t0 },
    );
    // Earlier timestamp than the "previous" point (elapsedHours < 0) -
    // e.g. two updates arriving to the server out of send order.
    await service.checkGpsSpoof(
      'driver-1',
      { lat: 6.5244, lng: 3.3792, at: t0 },
      { lat: 6.6, lng: 3.4, at: new Date(t0.getTime() - 60_000) },
    );

    expect(flagsRepo.save).not.toHaveBeenCalled();
  });

  it('does not flag a speed exactly at the threshold - only strictly over it counts, so the boundary itself is not a false positive', async () => {
    const { service, flagsRepo } = buildService();
    const t0 = new Date('2026-01-01T10:00:00Z');
    // Exactly 250 km/h over exactly 1 hour.
    const previous = { lat: 0, lng: 0, at: t0 };
    const next = { lat: 2.2457, lng: 0, at: new Date(t0.getTime() + 3_600_000) }; // ~250km north

    await service.checkGpsSpoof('driver-1', previous, next);

    expect(flagsRepo.save).not.toHaveBeenCalled();
  });
});

describe('FraudService.checkGpsSpoof() - true positives', () => {
  it('flags an implied speed far beyond anything physically possible for a road vehicle', async () => {
    const { service, flagsRepo } = buildService();
    const t0 = new Date('2026-01-01T10:00:00Z');
    // ~120km in 60 seconds = ~7200 km/h - a genuine teleport, not a
    // delayed GPS ping under any realistic explanation.
    const previous = { lat: 6.5244, lng: 3.3792, at: t0 };
    const next = { lat: 7.5992, lng: 3.3792, at: new Date(t0.getTime() + 60_000) };

    await service.checkGpsSpoof('driver-1', previous, next);

    expect(flagsRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        type: FraudFlagType.GPS_SPOOF,
        userId: 'driver-1',
        severity: FraudFlagSeverity.HIGH,
        details: expect.objectContaining({ previous, next }),
      }),
    );
  });

  it('includes the computed speed/distance/elapsed time in the flag details, not just the raw points - an admin reviewing this flag needs the numbers, not just coordinates to do the arithmetic themselves', async () => {
    const { service, flagsRepo } = buildService();
    const t0 = new Date('2026-01-01T10:00:00Z');
    const previous = { lat: 6.5244, lng: 3.3792, at: t0 };
    const next = { lat: 7.5992, lng: 3.3792, at: new Date(t0.getTime() + 60_000) };

    await service.checkGpsSpoof('driver-1', previous, next);

    const savedDetails = (flagsRepo.save as jest.Mock).mock.calls[0][0].details;
    expect(savedDetails.impliedSpeedKmh).toBeGreaterThan(250);
    expect(savedDetails.distanceKm).toBeGreaterThan(0);
    expect(savedDetails.elapsedSeconds).toBe(60);
  });

  it('flags a speed just barely over the threshold, not only extreme teleports', async () => {
    const { service, flagsRepo } = buildService();
    const t0 = new Date('2026-01-01T10:00:00Z');
    // 251 km/h over 1 hour - just past the line.
    const previous = { lat: 0, lng: 0, at: t0 };
    const next = { lat: 2.2547, lng: 0, at: new Date(t0.getTime() + 3_600_000) };

    await service.checkGpsSpoof('driver-1', previous, next);

    expect(flagsRepo.save).toHaveBeenCalledWith(expect.objectContaining({ type: FraudFlagType.GPS_SPOOF }));
  });
});

describe('FraudService.checkReferralAbuse() - false positives', () => {
  it('does not flag when referrer and referee have entirely different devices', async () => {
    const { service, flagsRepo, devicesRepo } = buildService({
      devicesRepo: {
        find: jest.fn((arg: any) =>
          arg.where.userId === 'referrer-1'
            ? Promise.resolve([{ userId: 'referrer-1', fingerprint: 'fp-a' }])
            : Promise.resolve([{ userId: 'referee-1', fingerprint: 'fp-b' }]),
        ),
      },
    });

    await service.checkReferralAbuse('referrer-1', 'referee-1');

    expect(flagsRepo.save).not.toHaveBeenCalled();
    expect(devicesRepo.find).toHaveBeenCalledTimes(2);
  });

  it('does not flag when neither party has any devices on file at all', async () => {
    const { service, flagsRepo } = buildService({
      devicesRepo: { find: jest.fn().mockResolvedValue([]) },
    });

    await service.checkReferralAbuse('referrer-1', 'referee-1');

    expect(flagsRepo.save).not.toHaveBeenCalled();
  });

  it('does not flag when each side has several devices but none overlap', async () => {
    const { service, flagsRepo } = buildService({
      devicesRepo: {
        find: jest.fn((arg: any) =>
          arg.where.userId === 'referrer-1'
            ? Promise.resolve([
                { userId: 'referrer-1', fingerprint: 'fp-a' },
                { userId: 'referrer-1', fingerprint: 'fp-b' },
              ])
            : Promise.resolve([
                { userId: 'referee-1', fingerprint: 'fp-c' },
                { userId: 'referee-1', fingerprint: 'fp-d' },
              ]),
        ),
      },
    });

    await service.checkReferralAbuse('referrer-1', 'referee-1');

    expect(flagsRepo.save).not.toHaveBeenCalled();
  });
});

describe('FraudService.checkReferralAbuse() - true positives', () => {
  it('flags when referrer and referee share exactly one device fingerprint - the classic self-referral pattern', async () => {
    const { service, flagsRepo } = buildService({
      devicesRepo: {
        find: jest.fn((arg: any) =>
          arg.where.userId === 'referrer-1'
            ? Promise.resolve([{ userId: 'referrer-1', fingerprint: 'fp-shared' }])
            : Promise.resolve([{ userId: 'referee-1', fingerprint: 'fp-shared' }]),
        ),
      },
    });

    await service.checkReferralAbuse('referrer-1', 'referee-1');

    expect(flagsRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        type: FraudFlagType.REFERRAL_ABUSE,
        userId: 'referee-1',
        relatedUserId: 'referrer-1',
        severity: FraudFlagSeverity.HIGH,
        details: expect.objectContaining({ sharedFingerprint: 'fp-shared' }),
      }),
    );
  });

  it('still flags when the shared device is only one of several each side owns - any overlap at all is the signal, not exclusivity', async () => {
    const { service, flagsRepo } = buildService({
      devicesRepo: {
        find: jest.fn((arg: any) =>
          arg.where.userId === 'referrer-1'
            ? Promise.resolve([
                { userId: 'referrer-1', fingerprint: 'fp-own-1' },
                { userId: 'referrer-1', fingerprint: 'fp-shared' },
              ])
            : Promise.resolve([
                { userId: 'referee-1', fingerprint: 'fp-shared' },
                { userId: 'referee-1', fingerprint: 'fp-own-2' },
              ]),
        ),
      },
    });

    await service.checkReferralAbuse('referrer-1', 'referee-1');

    expect(flagsRepo.save).toHaveBeenCalledWith(expect.objectContaining({ type: FraudFlagType.REFERRAL_ABUSE }));
  });
});
