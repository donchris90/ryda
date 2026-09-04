import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { User } from '../users/entities/user.entity';
import { SupportService, SUPPORT_STAFF_ROLES } from './support.service';
import { AddMessageDto, AssignTicketDto, CreateTicketDto, UpdateTicketPriorityDto } from './dto/support.dto';
import { TicketStatus } from './entities/support-ticket.entity';
import { Audit } from '../audit/decorators/audit.decorator';

@Controller()
@UseGuards(JwtAuthGuard)
export class SupportController {
  constructor(private readonly supportService: SupportService) {}

  @Post('support/tickets')
  create(@CurrentUser() user: User, @Body() dto: CreateTicketDto) {
    // A customer can't self-declare their own ticket URGENT - only
    // staff logging a ticket on a caller's behalf get to set priority
    // directly at creation (see CreateTicketDto's own doc comment).
    const isStaff = SUPPORT_STAFF_ROLES.includes(user.role as UserRole);
    return this.supportService.createTicket(user.id, isStaff ? dto : { ...dto, priority: undefined });
  }

  @Get('support/tickets/mine')
  mine(@CurrentUser() user: User) {
    return this.supportService.listMine(user.id);
  }

  @Get('support/tickets/:id')
  async get(@CurrentUser() user: User, @Param('id') id: string) {
    return this.supportService.assertCanAccess(id, user.id, user.role);
  }

  @Post('support/tickets/:id/messages')
  addMessage(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: AddMessageDto) {
    return this.supportService.addMessage(id, user.id, user.role, dto);
  }

  @Get('support/tickets/:id/messages')
  listMessages(@CurrentUser() user: User, @Param('id') id: string) {
    return this.supportService.listMessages(id, user.id, user.role);
  }

  @Patch('support/tickets/:id/status/:status')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.SUPPORT_AGENT)
  @Audit('support_ticket.status_change')
  updateStatus(@Param('id') id: string, @Param('status') status: TicketStatus) {
    return this.supportService.updateStatus(id, status);
  }

  @Patch('support/tickets/:id/assign')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.SUPPORT_AGENT)
  @Audit('support_ticket.assign')
  assign(@Param('id') id: string, @Body() dto: AssignTicketDto) {
    return this.supportService.assign(id, dto.agentUserId);
  }

  /** Also recomputes the SLA due-by timestamp for the new priority - see SupportService.setPriority(). */
  @Patch('support/tickets/:id/priority')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.SUPPORT_AGENT)
  @Audit('support_ticket.priority_change')
  setPriority(@Param('id') id: string, @Body() dto: UpdateTicketPriorityDto) {
    return this.supportService.setPriority(id, dto.priority);
  }

  @Get('admin/support/tickets')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.SUPPORT_AGENT)
  listAll(
    @Query('status') status?: TicketStatus,
    @Query('category') category?: string,
    @Query('assignedAgentId') assignedAgentId?: string,
    @Query('breachedOnly') breachedOnly?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.supportService.listAll({
      status,
      category,
      assignedAgentId,
      breachedOnly: breachedOnly === 'true',
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
    });
  }
}
