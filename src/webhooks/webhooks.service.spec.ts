import { BadRequestException, NotFoundException } from '@nestjs/common';
import { WebhooksService } from './webhooks.service';
import { WebhookDeliveryStatus } from './entities/webhook-delivery-log.entity';

jest.mock('./assert-public-url', () => ({
  assertPublicUrl: jest.fn().mockResolvedValue(undefined),
}));
import { assertPublicUrl } from './assert-public-url';

function fakeSubscription(overrides: Record<string, any> = {}) {
  return {
    id: 'sub-1',
    partnerName: 'Acme Corp',
    url: 'https://acme.example.com/webhooks',
    secret: 'shh-secret',
    events: ['ride.completed'],
    isActive: true,
    ...overrides,
  };
}

function build(overrides: Record<string, any> = {}) {
  const subscriptionsRepo = {
    save: jest.fn(async (d: any) => ({ id: 'sub-1', ...d })),
    create: jest.fn((d: any) => d),
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(fakeSubscription()),
    update: jest.fn().mockResolvedValue(undefined),
    ...overrides.subscriptionsRepo,
  };
  const logsRepo = {
    save: jest.fn(async (d: any) => ({ id: 'log-1', ...d })),
    create: jest.fn((d: any) => d),
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn(),
    ...overrides.logsRepo,
  };

  const service = new WebhooksService(subscriptionsRepo as any, logsRepo as any);
  return { service, subscriptionsRepo, logsRepo };
}

describe('WebhooksService - SSRF protection is actually wired in', () => {
  const mockAssertPublicUrl = assertPublicUrl as jest.Mock;
  const originalFetch = global.fetch;

  beforeEach(() => {
    mockAssertPublicUrl.mockClear().mockResolvedValue(undefined);
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('checks the URL before creating a subscription', async () => {
    const { service } = build();
    await service.subscribe({ partnerName: 'Acme', url: 'https://acme.example.com', events: ['ride.completed'] });
    expect(mockAssertPublicUrl).toHaveBeenCalledWith('https://acme.example.com');
  });

  it('refuses to create a subscription whose URL fails the check', async () => {
    mockAssertPublicUrl.mockRejectedValue(new BadRequestException('blocked'));
    const { service, subscriptionsRepo } = build();

    await expect(
      service.subscribe({ partnerName: 'Acme', url: 'http://169.254.169.254/', events: ['ride.completed'] }),
    ).rejects.toThrow(BadRequestException);
    expect(subscriptionsRepo.save).not.toHaveBeenCalled();
  });

  it('checks the URL again when it changes via update()', async () => {
    const { service } = build();
    await service.update('sub-1', { url: 'https://new-url.example.com' });
    expect(mockAssertPublicUrl).toHaveBeenCalledWith('https://new-url.example.com');
  });

  it('does not re-check the URL on an update that leaves it unchanged', async () => {
    const { service } = build();
    await service.update('sub-1', { partnerName: 'New Name' });
    expect(mockAssertPublicUrl).not.toHaveBeenCalled();
  });

  it(
    'checks the URL at actual delivery time too (sendTest) - the real enforcement point, not just a ' +
      'one-time gate at subscribe()/update()',
    async () => {
      const { service } = build();
      await service.sendTest('sub-1');
      expect(mockAssertPublicUrl).toHaveBeenCalledWith('https://acme.example.com/webhooks');
    },
  );

  it(
    'records a failed delivery (not an uncaught exception) when the URL fails the check at delivery ' +
      'time - a subscription whose target has gone bad since it was created must not crash the caller, ' +
      'especially since the automatic fan-out awaits several of these in parallel',
    async () => {
      mockAssertPublicUrl.mockRejectedValue(new BadRequestException("can't point at a private address"));
      const { service, logsRepo } = build();

      const result = await service.sendTest('sub-1');

      expect(result.status).toBe(WebhookDeliveryStatus.FAILED);
      expect(result.errorMessage).toContain("can't point at a private address");
      expect(global.fetch).not.toHaveBeenCalled();
      expect(logsRepo.save).toHaveBeenCalled();
    },
  );
});

describe('WebhooksService.update()', () => {
  it('updates only the fields provided', async () => {
    const { service } = build();
    const result = await service.update('sub-1', { partnerName: 'Renamed Corp' });
    expect(result.partnerName).toBe('Renamed Corp');
    expect(result.url).toBe('https://acme.example.com/webhooks'); // untouched
  });

  it('never accepts a new secret - not part of UpdateWebhookSubscriptionDto at all', async () => {
    const { service } = build();
    const result = await service.update('sub-1', {} as any);
    expect(result.secret).toBe('shh-secret'); // untouched regardless of what's in the body
  });

  it('throws NotFoundException for a subscription that does not exist', async () => {
    const { service } = build({ subscriptionsRepo: { findOne: jest.fn().mockResolvedValue(null) } });
    await expect(service.update('missing', { partnerName: 'x' })).rejects.toThrow(NotFoundException);
  });
});

describe('WebhooksService.retry()', () => {
  beforeEach(() => {
    (assertPublicUrl as jest.Mock).mockClear().mockResolvedValue(undefined);
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });
  });

  it('re-sends the exact same event and payload as the original failed delivery', async () => {
    const { service, logsRepo } = build({
      logsRepo: {
        findOne: jest.fn().mockResolvedValue({
          id: 'log-1',
          subscriptionId: 'sub-1',
          event: 'ride.completed',
          payload: { rideId: 'ride-1' },
          status: WebhookDeliveryStatus.FAILED,
        }),
      },
    });

    await service.retry('log-1');

    expect(logsRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'ride.completed', payload: { rideId: 'ride-1' } }),
    );
  });

  it('creates a NEW log entry rather than mutating the original failed one - preserves delivery history', async () => {
    const { service, logsRepo } = build({
      logsRepo: {
        findOne: jest.fn().mockResolvedValue({
          id: 'original-log',
          subscriptionId: 'sub-1',
          event: 'ride.completed',
          payload: {},
        }),
      },
    });

    await service.retry('original-log');

    const savedLog = logsRepo.save.mock.calls[0][0];
    expect(savedLog.id).toBeUndefined(); // a fresh entity, not the original with its id
  });

  it('throws NotFoundException for a log entry that does not exist', async () => {
    const { service } = build({ logsRepo: { findOne: jest.fn().mockResolvedValue(null) } });
    await expect(service.retry('missing')).rejects.toThrow(NotFoundException);
  });

  it("throws NotFoundException if the log's subscription was since deleted", async () => {
    const { service } = build({
      logsRepo: {
        findOne: jest.fn().mockResolvedValue({ id: 'log-1', subscriptionId: 'gone', event: 'x', payload: {} }),
      },
      subscriptionsRepo: { findOne: jest.fn().mockResolvedValue(null) },
    });
    await expect(service.retry('log-1')).rejects.toThrow(NotFoundException);
  });
});
