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
  const africasTalking = {
    isConfigured: jest.fn().mockReturnValue(true),
    sendSms: jest.fn().mockResolvedValue({ success: true }),
    ...overrides.africasTalking,
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
    africasTalking as any,
    sendgrid as any,
    fcm as any,
    expoPush as any,
    usersService as any,
    mailerService as any,
    notificationsQueue as any,
  );

  return { service, notificationsRepo, twilio, africasTalking, sendgrid, mailerService, usersService, notificationsQueue };
}

describe('NotificationsService - idempotency (retry-safety)', () => {
  it('does not re-send SMS when a SENT record already exists under the same idempotency key', async () => {
    const { service, notificationsRepo, africasTalking } = build({
      notificationsRepo: {
        findOne: jest.fn().mockResolvedValue(fakeNotification({ status: NotificationStatus.SENT, idempotencyKey: 'job-1' })),
      },
    });

    await service.sendSms('user-1', '+2340000000', 'Title', 'Body', undefined, 'job-1');

    expect(africasTalking.sendSms).not.toHaveBeenCalled();
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
    const { service, africasTalking } = build({
      notificationsRepo: {
        findOne: jest.fn().mockResolvedValue(fakeNotification({ status: NotificationStatus.FAILED, idempotencyKey: 'job-3' })),
      },
    });

    await service.sendSms('user-1', '+2340000000', 'Title', 'Body', undefined, 'job-3');

    expect(africasTalking.sendSms).toHaveBeenCalled();
  });

  it('sends normally (no dedupe lookup at all) when no idempotency key is given - a direct, non-queued send', async () => {
    const { service, notificationsRepo, africasTalking } = build();

    await service.sendSms('user-1', '+2340000000', 'Title', 'Body');

    expect(notificationsRepo.findOne).not.toHaveBeenCalled();
    expect(africasTalking.sendSms).toHaveBeenCalled();
  });

  it('a different idempotency key is treated as a genuinely new notification, not a duplicate', async () => {
    const { service, africasTalking, notificationsRepo } = build({
      notificationsRepo: {
        // No record matches THIS key - findOne simulates a fresh key with nothing on file
        findOne: jest.fn().mockResolvedValue(null),
      },
    });

    await service.sendSms('user-1', '+2340000000', 'Title', 'Body', undefined, 'job-new');

    expect(africasTalking.sendSms).toHaveBeenCalled();
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
      rideId: 'ride-1',
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
      service.onScheduledRideReminder({ passengerId: 'passenger-1', pickupAddress: '12 Marina Road', scheduledAt: null, rideId: 'ride-1' }),
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

/**
 * These handlers previously passed `undefined` for metadata on every
 * passenger-facing event - the notification would show in the list,
 * but tapping it (in-app or via the OS push) had nothing to route on.
 * Locking in that each one now carries enough for the client to
 * navigate somewhere specific.
 */
describe('NotificationsService - notification metadata for tap routing', () => {
  it('ride.accepted carries {type: ride, rideId}', async () => {
    const { service, notificationsQueue } = build();
    await service.onRideAccepted({ passengerId: 'passenger-1', driverName: 'Tunde', rideId: 'ride-1' });
    expect(notificationsQueue.add).toHaveBeenCalledWith(
      'send',
      expect.objectContaining({ metadata: { type: 'ride', rideId: 'ride-1' } }),
      expect.anything(),
    );
  });

  it('ride.arrived carries {type: ride, rideId}', async () => {
    const { service, notificationsQueue } = build();
    await service.onRideArrived({ passengerId: 'passenger-1', rideId: 'ride-2' });
    expect(notificationsQueue.add).toHaveBeenCalledWith(
      'send',
      expect.objectContaining({ metadata: { type: 'ride', rideId: 'ride-2' } }),
      expect.anything(),
    );
  });

  it('ride.completed carries {type: ride, rideId} for both passenger and driver', async () => {
    const { service, notificationsQueue } = build();
    await service.onRideCompleted({ passengerId: 'p-1', driverId: 'd-1', totalFare: '2500.00', rideId: 'ride-3' });
    const calls = notificationsQueue.add.mock.calls;
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call[1]).toEqual(expect.objectContaining({ metadata: { type: 'ride', rideId: 'ride-3' } }));
    }
  });

  it('ride.cancelled carries {type: ride, rideId}', async () => {
    const { service, notificationsQueue } = build();
    await service.onRideCancelled({ notifyUserId: 'passenger-1', reason: 'Driver unavailable', rideId: 'ride-4' });
    expect(notificationsQueue.add).toHaveBeenCalledWith(
      'send',
      expect.objectContaining({ metadata: { type: 'ride', rideId: 'ride-4' } }),
      expect.anything(),
    );
  });

  it('payment.failed carries {type: ride, rideId} when tied to a ride', async () => {
    const { service, notificationsQueue } = build();
    await service.onPaymentFailed({ userId: 'passenger-1', reason: 'Card declined', rideId: 'ride-5' });
    expect(notificationsQueue.add).toHaveBeenCalledWith(
      'send',
      expect.objectContaining({ metadata: { type: 'ride', rideId: 'ride-5' } }),
      expect.anything(),
    );
  });

  it('payment.failed falls back to {type: wallet} when not tied to any ride', async () => {
    const { service, notificationsQueue } = build();
    await service.onPaymentFailed({ userId: 'passenger-1', reason: 'Card declined' });
    expect(notificationsQueue.add).toHaveBeenCalledWith(
      'send',
      expect.objectContaining({ metadata: { type: 'wallet' } }),
      expect.anything(),
    );
  });

  it('delivery.delivered carries {type: delivery, deliveryId} for both customer and driver', async () => {
    const { service, notificationsQueue } = build();
    await service.onDeliveryDelivered({ customerId: 'c-1', driverId: 'd-1', totalFare: '1500.00', deliveryId: 'delivery-1' });
    const calls = notificationsQueue.add.mock.calls;
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call[1]).toEqual(expect.objectContaining({ metadata: { type: 'delivery', deliveryId: 'delivery-1' } }));
    }
  });

  it('delivery.cancelled carries {type: delivery, deliveryId}', async () => {
    const { service, notificationsQueue } = build();
    await service.onDeliveryCancelled({ notifyUserId: 'c-1', reason: 'No courier found', deliveryId: 'delivery-2' });
    expect(notificationsQueue.add).toHaveBeenCalledWith(
      'send',
      expect.objectContaining({ metadata: { type: 'delivery', deliveryId: 'delivery-2' } }),
      expect.anything(),
    );
  });

  it('referral.bonus_granted carries {type: wallet}', async () => {
    const { service, notificationsQueue } = build();
    await service.onReferralBonusGranted({ userId: 'user-1', amount: '500.00' });
    expect(notificationsQueue.add).toHaveBeenCalledWith(
      'send',
      expect.objectContaining({ metadata: { type: 'wallet' } }),
      expect.anything(),
    );
  });

  it('support.ticket.created and support.ticket.status_changed carry {type: support, ticketId}', async () => {
    const { service, notificationsQueue } = build();
    await service.onTicketCreated({ userId: 'user-1', ticketId: 'ticket-1', subject: 'App crashed' });
    await service.onTicketStatusChanged({ userId: 'user-1', ticketId: 'ticket-1', status: 'resolved' });
    for (const call of notificationsQueue.add.mock.calls) {
      expect(call[1]).toEqual(expect.objectContaining({ metadata: { type: 'support', ticketId: 'ticket-1' } }));
    }
  });
});

describe('NotificationsService - driver-facing notification metadata for tap routing', () => {
  it('driver.approval.changed carries {type: documents}', async () => {
    const { service, notificationsQueue } = build();
    await service.onDriverApprovalChanged({ userId: 'driver-1', approved: true });
    expect(notificationsQueue.add).toHaveBeenCalledWith(
      'send',
      expect.objectContaining({ metadata: { type: 'documents' } }),
      expect.anything(),
    );
  });

  it('driver.document.expiring carries {type: documents}', async () => {
    const { service, notificationsQueue } = build();
    await service.onDriverDocumentExpiring({ userId: 'driver-1', documentType: 'insurance', daysLeft: 5 });
    expect(notificationsQueue.add).toHaveBeenCalledWith(
      'send',
      expect.objectContaining({ metadata: { type: 'documents' } }),
      expect.anything(),
    );
  });

  it('incentive.rewarded carries {type: wallet}', async () => {
    const { service, notificationsQueue } = build();
    await service.onIncentiveRewarded({ driverUserId: 'driver-1', incentiveName: 'Weekend push', amount: '2000.00' });
    expect(notificationsQueue.add).toHaveBeenCalledWith(
      'send',
      expect.objectContaining({ metadata: { type: 'wallet' } }),
      expect.anything(),
    );
  });
});
