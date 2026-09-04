import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SupportTicket, TicketStatus, TicketPriority } from './entities/support-ticket.entity';
import { TicketMessage } from './entities/ticket-message.entity';
import { CreateTicketDto, AddMessageDto } from './dto/support.dto';
import { ADMIN_LIKE_ROLES, UserRole } from '../common/enums/user-role.enum';
import { User } from '../users/entities/user.entity';
import { SystemSettingsService, SETTING_KEYS } from '../settings/settings.service';

export interface TicketFilters {
  status?: TicketStatus;
  category?: string;
  assignedAgentId?: string;
  breachedOnly?: boolean;
  page?: number;
  pageSize?: number;
}

export const SUPPORT_STAFF_ROLES = [...ADMIN_LIKE_ROLES, UserRole.SUPPORT_AGENT];

@Injectable()
export class SupportService {
  constructor(
    @InjectRepository(SupportTicket)
    private readonly ticketsRepo: Repository<SupportTicket>,
    @InjectRepository(TicketMessage)
    private readonly messagesRepo: Repository<TicketMessage>,
    private readonly events: EventEmitter2,
    private readonly settingsService: SystemSettingsService,
  ) {}

  async createTicket(userId: string, dto: CreateTicketDto): Promise<SupportTicket> {
    const priority = dto.priority ?? TicketPriority.NORMAL;
    const ticket = await this.ticketsRepo.save(
      this.ticketsRepo.create({
        userId,
        category: dto.category,
        subject: dto.subject,
        description: dto.description,
        rideId: dto.rideId ?? null,
        paymentId: dto.paymentId ?? null,
        priority,
        dueAt: await this.computeDueAt(priority),
      }),
    );

    this.events.emit('support.ticket.created', { userId, ticketId: ticket.id, subject: ticket.subject });
    return ticket;
  }

  /**
   * SLA due-by timestamp for a given priority, using the admin-
   * configured minutes-to-resolve for that tier (falls back to a
   * sane default if never configured). Recomputed - not just set
   * once at creation - because a ticket's priority can change after
   * the fact (assign(), setPriority()), and its SLA clock should
   * reflect the priority it's actually at now, not what it started at.
   */
  private async computeDueAt(priority: TicketPriority): Promise<Date> {
    const key = {
      [TicketPriority.URGENT]: SETTING_KEYS.SLA_RESOLUTION_MINUTES_URGENT,
      [TicketPriority.HIGH]: SETTING_KEYS.SLA_RESOLUTION_MINUTES_HIGH,
      [TicketPriority.NORMAL]: SETTING_KEYS.SLA_RESOLUTION_MINUTES_NORMAL,
      [TicketPriority.LOW]: SETTING_KEYS.SLA_RESOLUTION_MINUTES_LOW,
    }[priority];
    const defaultMinutes = {
      [TicketPriority.URGENT]: 60,
      [TicketPriority.HIGH]: 240,
      [TicketPriority.NORMAL]: 1440,
      [TicketPriority.LOW]: 4320,
    }[priority];
    const minutes = await this.settingsService.getNumber(key, defaultMinutes);
    return new Date(Date.now() + minutes * 60 * 1000);
  }

  /** Changing priority re-computes the SLA due-by timestamp - a ticket bumped to URGENT gets URGENT's clock, not its original one. */
  async setPriority(ticketId: string, priority: TicketPriority): Promise<SupportTicket> {
    const ticket = await this.findById(ticketId);
    ticket.priority = priority;
    ticket.dueAt = await this.computeDueAt(priority);
    return this.ticketsRepo.save(ticket);
  }

  async findById(id: string): Promise<SupportTicket> {
    const ticket = await this.ticketsRepo.findOne({ where: { id } });
    if (!ticket) throw new NotFoundException('Ticket not found');
    return ticket;
  }

  async listMine(userId: string): Promise<SupportTicket[]> {
    return this.ticketsRepo.find({ where: { userId }, order: { createdAt: 'DESC' } });
  }

  /**
   * Enriched with the requester's name/phone via the same lightweight
   * join pattern as the admin rides/drivers lists — `SupportTicket`
   * returned bare `userId` with no readable name, the same gap already
   * found and fixed twice elsewhere. Applying the `::text` cast on the
   * uuid side up front this time (User.id is a real Postgres `uuid`
   * column, SupportTicket.userId is plain `varchar`) rather than
   * discovering the type mismatch by hitting a live 500 again.
   */
  async listAll(filters: TicketFilters): Promise<{ data: unknown[]; total: number; page: number; pageSize: number }> {
    const page = filters.page ?? 1;
    const pageSize = Math.min(filters.pageSize ?? 50, 200);

    const qb = this.ticketsRepo
      .createQueryBuilder('ticket')
      .leftJoin(User, 'requester', 'requester.id::text = ticket.userId')
      .select('ticket.id', 'id')
      .addSelect('ticket.category', 'category')
      .addSelect('ticket.subject', 'subject')
      .addSelect('ticket.description', 'description')
      .addSelect('ticket.status', 'status')
      .addSelect('ticket.priority', 'priority')
      .addSelect('ticket.rideId', 'rideId')
      .addSelect('ticket.paymentId', 'paymentId')
      .addSelect('ticket.assignedAgentId', 'assignedAgentId')
      .addSelect('ticket.createdAt', 'createdAt')
      .addSelect('ticket.resolvedAt', 'resolvedAt')
      .addSelect('ticket.dueAt', 'dueAt')
      .addSelect('ticket.firstRespondedAt', 'firstRespondedAt')
      .addSelect('requester.firstName', 'requesterFirstName')
      .addSelect('requester.lastName', 'requesterLastName')
      .addSelect('requester.phone', 'requesterPhone')
      .addSelect('requester.role', 'requesterRole')
      .orderBy('ticket.createdAt', 'DESC');

    if (filters.status) qb.andWhere('ticket.status = :status', { status: filters.status });
    if (filters.category) qb.andWhere('ticket.category = :category', { category: filters.category });
    if (filters.assignedAgentId) qb.andWhere('ticket.assignedAgentId = :agentId', { agentId: filters.assignedAgentId });
    if (filters.breachedOnly) {
      qb.andWhere('ticket.dueAt IS NOT NULL AND ticket.dueAt < :now', { now: new Date() });
      qb.andWhere('ticket.status NOT IN (:...openTerminalStatuses)', {
        openTerminalStatuses: [TicketStatus.RESOLVED, TicketStatus.CLOSED],
      });
    }

    const total = await qb.getCount();
    const data = await qb
      .offset((page - 1) * pageSize)
      .limit(pageSize)
      .getRawMany();

    return { data, total, page, pageSize };
  }

  async assign(ticketId: string, agentUserId: string): Promise<SupportTicket> {
    const ticket = await this.findById(ticketId);
    ticket.assignedAgentId = agentUserId;
    if (ticket.status === TicketStatus.OPEN) ticket.status = TicketStatus.IN_PROGRESS;
    return this.ticketsRepo.save(ticket);
  }

  async updateStatus(ticketId: string, status: TicketStatus): Promise<SupportTicket> {
    const ticket = await this.findById(ticketId);
    ticket.status = status;
    if (status === TicketStatus.RESOLVED || status === TicketStatus.CLOSED) {
      ticket.resolvedAt = new Date();
    }
    const saved = await this.ticketsRepo.save(ticket);

    this.events.emit('support.ticket.status_changed', {
      userId: ticket.userId,
      ticketId: ticket.id,
      status,
    });
    return saved;
  }

  // ---- Messages ----

  async addMessage(
    ticketId: string,
    senderId: string,
    senderRole: string,
    dto: AddMessageDto,
  ): Promise<TicketMessage> {
    const ticket = await this.assertCanAccess(ticketId, senderId, senderRole);
    const saved = await this.messagesRepo.save(
      this.messagesRepo.create({
        ticketId,
        senderId,
        senderRole,
        message: dto.message,
        attachmentUrl: dto.attachmentUrl ?? null,
      }),
    );

    // First-response SLA: only a genuine staff reply counts, not the
    // customer's own opening message or their own follow-ups - "how
    // long until someone from support first replied", not "how long
    // until this ticket had any message at all" (which the ticket's
    // own createdAt already answers).
    if (SUPPORT_STAFF_ROLES.includes(senderRole as UserRole) && !ticket.firstRespondedAt) {
      ticket.firstRespondedAt = saved.createdAt;
      await this.ticketsRepo.save(ticket);
    }

    // Mirrors ride.message.sent exactly — TrackingGateway.broadcastTicketMessage()
    // listens for this to deliver live, the same way ride chat already does.
    this.events.emit('support.message.sent', {
      ticketId,
      id: saved.id,
      senderId: saved.senderId,
      senderRole: saved.senderRole,
      message: saved.message,
      createdAt: saved.createdAt,
    });
    return saved;
  }

  async listMessages(ticketId: string, requesterId: string, requesterRole: string): Promise<TicketMessage[]> {
    await this.assertCanAccess(ticketId, requesterId, requesterRole);
    return this.messagesRepo.find({ where: { ticketId }, order: { createdAt: 'ASC' } });
  }

  async assertCanAccess(ticketId: string, userId: string, role: string): Promise<SupportTicket> {
    const ticket = await this.findById(ticketId);
    const isOwner = ticket.userId === userId;
    const isStaff = SUPPORT_STAFF_ROLES.includes(role as UserRole);
    if (!isOwner && !isStaff) {
      throw new ForbiddenException('You do not have access to this ticket');
    }
    return ticket;
  }
}
