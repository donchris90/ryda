import { NotificationsService } from './notifications.service';
import { NotificationChannel, NotificationCategory, NotificationStatus } from './entities/notification.entity';

function fakeNotification(overrides: Record<string, any> = {}) {
  return {
    id: `notif-${Math.random()}`,
    userId: 'user-1',
    channel: NotificationChannel.EMAIL,
    status: NotificationStatus.PENDING,
    idempotencyKey: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function build(overrides: Record<string, any> = {}) {
  const notificationsRepo = {
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn((d: any) => fakeNotification(d)),
    save: jest.fn(async (d: any) => d),
    ...overrides.notificationsRepo,
  };
  const deviceTokensRepo = { find: jest.fn().mockResolvedValue([]), ...overrides.deviceTokensRepo };
  const twilio = {
    isSmsConfigured: jest.fn().mockReturnValue(true),
    isWhatsappConfigured: jest.fn().mockReturnValue(true),
    sendSms: jest.fn().mockResolvedValue({ success: true }),
    sendWhatsapp: jest.fn().mockResolvedValue({ success: true }),
    ...overrides.twilio,
  };
  const sendgrid = {
    isConfigured: jest.fn().mockReturnValue(true),
    sendEmail: jest.fn().mockResolvedValue({ success: true }),
    ...overrides.sendgrid,
  };
  const fcm = { isConfigured: jest.fn().mockReturnValue(false) };
  const expoPush = { isExpoPushToken: jest.fn().mockReturnValue(false) };
  const usersService = {
    findById: jest.fn().mockResolvedValue({ id: 'user-1', phone: '+2340000000', email: 'ada@example.com' }),
    ...overrides.usersService,
  };
  const mailerService = {
    isConfigured: jest.fn().mockReturnValue(true),
    send: jest.fn().mockResolvedValue({ success: true }),
    ...overrides.mailerService,
  };
  const notificationsQueue = { add: jest.fn() };

  const service = new NotificationsService(
    notificationsRepo as any,
    deviceTokensRepo as any,
    twilio as any,
    sendgrid as any,
    fcm as any,
    expoPush as any,
    usersService as any,
    mailerService as any,
    notificationsQueue as any,
  );

  return { service, notificationsRepo, twilio, sendgrid, mailerService, usersService, notificationsQueue };
}

describe('NotificationsService - idempotency (retry-safety)', () => {
  it('does not re-send SMS when a SENT record already exists under the same idempotency key', async () => {
    const { service, notificationsRepo, twilio } = build({
      notificationsRepo: {
        findOne: jest.fn().mockResolvedValue(fakeNotification({ status: NotificationStatus.SENT, idempotencyKey: 'job-1' })),
      },
    });

    await service.sendSms('user-1', '+2340000000', 'Title', 'Body', undefined, 'job-1');

    expect(twilio.sendSms).not.toHaveBeenCalled();
    expect(notificationsRepo.save).not.toHaveBeenCalled(); // no new record created either
  });

  it('does not re-send a SIMULATED notification under the same idempotency key', async () => {
    const { service, sendgrid } = build({
      notificationsRepo: {
        findOne: jest.fn().mockResolvedValue(fakeNotification({ channel: NotificationChannel.EMAIL, status: NotificationStatus.SIMULATED, idempotencyKey: 'job-2' })),
      },
    });

    await service.sendEmail('user-1', 'ada@example.com', 'Title', 'Body', undefined, 'job-2');

    expect(sendgrid.sendEmail).not.toHaveBeenCalled();
  });

  it('DOES retry the actual send when the prior record under the same key FAILED - a failure is not terminal', async () => {
    const { service, twilio } = build({
      notificationsRepo: {
        findOne: jest.fn().mockResolvedValue(fakeNotification({ status: NotificationStatus.FAILED, idempotencyKey: 'job-3' })),
      },
    });

    await service.sendSms('user-1', '+2340000000', 'Title', 'Body', undefined, 'job-3');

    expect(twilio.sendSms).toHaveBeenCalled();
  });

  it('sends normally (no dedupe lookup at all) when no idempotency key is given - a direct, non-queued send', async () => {
    const { service, notificationsRepo, twilio } = build();

    await service.sendSms('user-1', '+2340000000', 'Title', 'Body');

    expect(notificationsRepo.findOne).not.toHaveBeenCalled();
    expect(twilio.sendSms).toHaveBeenCalled();
  });

  it('a different idempotency key is treated as a genuinely new notification, not a duplicate', async () => {
    const { service, twilio, notificationsRepo } = build({
      notificationsRepo: {
        // No record matches THIS key - findOne simulates a fresh key with nothing on file
        findOne: jest.fn().mockResolvedValue(null),
      },
    });

    await service.sendSms('user-1', '+2340000000', 'Title', 'Body', undefined, 'job-new');

    expect(twilio.sendSms).toHaveBeenCalled();
    expect(notificationsRepo.create).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: 'job-new' }));
  });

  it("scopes the idempotency check to this exact user, channel, and key - notify() fanning out to multiple channels doesn't collide", async () => {
    const { service, notificationsRepo } = build();

    await service.notify('user-1', [NotificationChannel.SMS, NotificationChannel.EMAIL], 'T', 'B', undefined, NotificationCategory.SECURITY, 'job-4');

    const findOneCalls = notificationsRepo.findOne.mock.calls;
    expect(findOneCalls).toEqual(
      expect.arrayContaining([
        [expect.objectContaining({ where: { userId: 'user-1', channel: NotificationChannel.SMS, idempotencyKey: 'job-4' } })],
        [expect.objectContaining({ where: { userId: 'user-1', channel: NotificationChannel.EMAIL, idempotencyKey: 'job-4' } })],
      ]),
    );
  });
});

describe('NotificationsService.sendEmail() - SendGrid to Brevo failover', () => {
  it('uses SendGrid when it succeeds, never touching the fallback', async () => {
    const { service, sendgrid, mailerService } = build();

    await service.sendEmail('user-1', 'ada@example.com', 'Title', 'Body');

    expect(sendgrid.sendEmail).toHaveBeenCalled();
    expect(mailerService.send).not.toHaveBeenCalled();
  });

  it('falls back to Brevo when SendGrid is configured but the send itself fails', async () => {
    const { service, sendgrid, mailerService, notificationsRepo } = build({
      sendgrid: { isConfigured: jest.fn().mockReturnValue(true), sendEmail: jest.fn().mockResolvedValue({ success: false, error: 'SendGrid down' }) },
    });

    const result = await service.sendEmail('user-1', 'ada@example.com', 'Title', 'Body');

    expect(mailerService.send).toHaveBeenCalledWith('ada@example.com', 'Title', 'Body');
    expect(notificationsRepo.save).toHaveBeenLastCalledWith(expect.objectContaining({ status: NotificationStatus.SENT }));
    expect(result).toBeDefined();
  });

  it('falls back to Brevo directly when SendGrid is not configured at all - never even attempted', async () => {
    const { service, sendgrid, mailerService } = build({
      sendgrid: { isConfigured: jest.fn().mockReturnValue(false), sendEmail: jest.fn() },
    });

    await service.sendEmail('user-1', 'ada@example.com', 'Title', 'Body');

    expect(sendgrid.sendEmail).not.toHaveBeenCalled();
    expect(mailerService.send).toHaveBeenCalled();
  });

  it('only marks simulated when BOTH providers are unavailable - never fakes success', async () => {
    const { service } = build({
      sendgrid: { isConfigured: jest.fn().mockReturnValue(false) },
      mailerService: { isConfigured: jest.fn().mockReturnValue(false), send: jest.fn() },
    });

    const result = await service.sendEmail('user-1', 'ada@example.com', 'Title', 'Body');

    expect(result.status).toBe(NotificationStatus.SIMULATED);
  });

  it('reports the real failure status when both SendGrid and the Brevo fallback fail', async () => {
    const { service } = build({
      sendgrid: { isConfigured: jest.fn().mockReturnValue(true), sendEmail: jest.fn().mockResolvedValue({ success: false, error: 'down' }) },
      mailerService: { isConfigured: jest.fn().mockReturnValue(true), send: jest.fn().mockResolvedValue({ success: false, error: 'also down' }) },
    });

    const result = await service.sendEmail('user-1', 'ada@example.com', 'Title', 'Body');

    expect(result.status).toBe(NotificationStatus.FAILED);
  });
});

describe('NotificationsService.onScheduledRideReminder()', () => {
  it('enqueues an in-app + push reminder mentioning the pickup address', async () => {
    const { service, notificationsQueue } = build();

    await service.onScheduledRideReminder({
      passengerId: 'passenger-1',
      pickupAddress: '12 Marina Road',
      scheduledAt: new Date('2026-06-01T14:30:00Z'),
    });

    expect(notificationsQueue.add).toHaveBeenCalledWith(
      'send',
      expect.objectContaining({
        userId: 'passenger-1',
        channels: expect.arrayContaining([NotificationChannel.IN_APP, NotificationChannel.PUSH]),
        body: expect.stringContaining('12 Marina Road'),
      }),
      expect.anything(),
    );
  });

  it('still enqueues a reminder (with a generic time) when scheduledAt is missing, rather than throwing', async () => {
    const { service, notificationsQueue } = build();

    await expect(
      service.onScheduledRideReminder({ passengerId: 'passenger-1', pickupAddress: '12 Marina Road', scheduledAt: null }),
    ).resolves.toBeUndefined();
    expect(notificationsQueue.add).toHaveBeenCalled();
  });
});

describe('NotificationsService.onSplitFareExpired()', () => {
  it('enqueues an in-app + push notification to the initiator', async () => {
    const { service, notificationsQueue } = build();

    await service.onSplitFareExpired({ initiatorId: 'initiator-1', rideId: 'ride-1' });

    expect(notificationsQueue.add).toHaveBeenCalledWith(
      'send',
      expect.objectContaining({
        userId: 'initiator-1',
        channels: expect.arrayContaining([NotificationChannel.IN_APP, NotificationChannel.PUSH]),
      }),
      expect.anything(),
    );
  });
});
