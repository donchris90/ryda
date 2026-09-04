import { SupportService, SUPPORT_STAFF_ROLES } from './support.service';
import { TicketPriority, TicketStatus } from './entities/support-ticket.entity';

function fakeTicket(overrides: Record<string, any> = {}) {
  return {
    id: 'ticket-1',
    userId: 'passenger-1',
    status: TicketStatus.OPEN,
    priority: TicketPriority.NORMAL,
    firstRespondedAt: null,
    ...overrides,
  };
}

function build(overrides: Record<string, any> = {}) {
  const ticketsRepo = {
    save: jest.fn(async (d: any) => ({ id: 'ticket-1', ...d })),
    create: jest.fn((d: any) => d),
    findOne: jest.fn().mockResolvedValue(fakeTicket()),
    ...overrides.ticketsRepo,
  };
  const messagesRepo = {
    save: jest.fn(async (d: any) => ({ id: 'message-1', createdAt: new Date('2026-01-01T00:00:00Z'), ...d })),
    create: jest.fn((d: any) => d),
    find: jest.fn().mockResolvedValue([]),
    ...overrides.messagesRepo,
  };
  const events = { emit: jest.fn() };
  const settingsService = {
    getNumber: jest.fn((_key: string, fallback: number) => Promise.resolve(fallback)),
    ...overrides.settingsService,
  };

  const service = new SupportService(ticketsRepo as any, messagesRepo as any, events as any, settingsService as any);
  return { service, ticketsRepo, messagesRepo, events, settingsService };
}

describe('SupportService.createTicket() - SLA due-by computation', () => {
  it('sets dueAt using the default NORMAL-priority window (24h) when no priority is given', async () => {
    const { service, ticketsRepo } = build();
    const before = Date.now();

    await service.createTicket('passenger-1', { subject: 'Help', description: 'Issue' } as any);

    const savedArg = ticketsRepo.create.mock.calls[0][0];
    expect(savedArg.priority).toBe(TicketPriority.NORMAL);
    const dueAtMs = savedArg.dueAt.getTime();
    expect(dueAtMs).toBeGreaterThanOrEqual(before + 24 * 60 * 60 * 1000 - 1000);
    expect(dueAtMs).toBeLessThanOrEqual(before + 24 * 60 * 60 * 1000 + 5000);
  });

  it('uses a much tighter window for URGENT (1h default) than NORMAL', async () => {
    const { service, ticketsRepo } = build();
    const before = Date.now();

    await service.createTicket('passenger-1', { subject: 'Help', description: 'Issue', priority: TicketPriority.URGENT } as any);

    const dueAtMs = ticketsRepo.create.mock.calls[0][0].dueAt.getTime();
    expect(dueAtMs).toBeLessThan(before + 2 * 60 * 60 * 1000);
  });

  it('respects an admin-configured SLA window instead of the hardcoded default', async () => {
    const { service, ticketsRepo } = build({
      settingsService: { getNumber: jest.fn().mockResolvedValue(30) }, // 30 minutes, whatever key is asked for
    });
    const before = Date.now();

    await service.createTicket('passenger-1', { subject: 'Help', description: 'Issue', priority: TicketPriority.URGENT } as any);

    const dueAtMs = ticketsRepo.create.mock.calls[0][0].dueAt.getTime();
    expect(dueAtMs).toBeGreaterThanOrEqual(before + 30 * 60 * 1000 - 1000);
    expect(dueAtMs).toBeLessThanOrEqual(before + 30 * 60 * 1000 + 5000);
  });

  it('links an optional paymentId, same as the existing rideId linkage', async () => {
    const { service, ticketsRepo } = build();

    await service.createTicket('passenger-1', { subject: 'Refund', description: 'x', paymentId: 'payment-1' } as any);

    expect(ticketsRepo.create).toHaveBeenCalledWith(expect.objectContaining({ paymentId: 'payment-1' }));
  });
});

describe('SupportService.setPriority()', () => {
  it("recomputes dueAt for the NEW priority's SLA window, not the ticket's original one", async () => {
    const { service, ticketsRepo } = build({
      ticketsRepo: { findOne: jest.fn().mockResolvedValue(fakeTicket({ priority: TicketPriority.LOW })) },
    });
    const before = Date.now();

    await service.setPriority('ticket-1', TicketPriority.URGENT);

    const saved = ticketsRepo.save.mock.calls[0][0];
    expect(saved.priority).toBe(TicketPriority.URGENT);
    expect(saved.dueAt.getTime()).toBeLessThan(before + 2 * 60 * 60 * 1000); // URGENT window, not LOW's multi-day one
  });
});

describe('SupportService.addMessage() - first-response SLA and attachments', () => {
  it('sets firstRespondedAt the first time STAFF (not the customer) sends a message', async () => {
    const { service, ticketsRepo } = build();

    await service.addMessage('ticket-1', 'agent-1', 'support_agent', { message: 'On it' } as any);

    expect(ticketsRepo.save).toHaveBeenCalledWith(expect.objectContaining({ firstRespondedAt: expect.any(Date) }));
  });

  it("does NOT set firstRespondedAt when the CUSTOMER sends a message, even their first one", async () => {
    const { service, ticketsRepo } = build();

    await service.addMessage('ticket-1', 'passenger-1', 'passenger', { message: 'Any update?' } as any);

    expect(ticketsRepo.save).not.toHaveBeenCalled();
  });

  it('does not overwrite firstRespondedAt on a SECOND staff reply', async () => {
    const { service, ticketsRepo } = build({
      ticketsRepo: { findOne: jest.fn().mockResolvedValue(fakeTicket({ firstRespondedAt: new Date('2026-01-01T00:00:00Z') })) },
    });

    await service.addMessage('ticket-1', 'agent-1', 'support_agent', { message: 'Following up' } as any);

    expect(ticketsRepo.save).not.toHaveBeenCalled();
  });

  it('links an attachmentUrl onto the saved message when one is provided', async () => {
    const { service, messagesRepo } = build();

    await service.addMessage('ticket-1', 'passenger-1', 'passenger', {
      message: 'Here is a screenshot',
      attachmentUrl: 'https://cdn.example.com/support-evidence/abc.png',
    } as any);

    expect(messagesRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ attachmentUrl: 'https://cdn.example.com/support-evidence/abc.png' }),
    );
  });

  it('stores null (not undefined) when no attachment is given', async () => {
    const { service, messagesRepo } = build();

    await service.addMessage('ticket-1', 'passenger-1', 'passenger', { message: 'Just text' } as any);

    expect(messagesRepo.create).toHaveBeenCalledWith(expect.objectContaining({ attachmentUrl: null }));
  });
});

describe('SUPPORT_STAFF_ROLES', () => {
  it('includes support_agent - the role addMessage() checks against for first-response tracking', () => {
    expect(SUPPORT_STAFF_ROLES).toContain('support_agent');
  });
});
