import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { WebhooksService, WEBHOOK_EVENTS } from './webhooks.service';
import { CreateWebhookSubscriptionDto } from './dto/webhook.dto';
import { Audit } from '../audit/decorators/audit.decorator';

@ApiTags('webhooks')
@Controller()
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Get('admin/webhooks/events')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  listAvailableEvents() {
    return WEBHOOK_EVENTS;
  }

  @Post('admin/webhooks/subscriptions')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Audit('webhook_subscription.create')
  subscribe(@Body() dto: CreateWebhookSubscriptionDto) {
    return this.webhooksService.subscribe(dto);
  }

  @Get('admin/webhooks/subscriptions')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  list() {
    return this.webhooksService.list();
  }

  @Patch('admin/webhooks/subscriptions/:id/active/:isActive')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Audit('webhook_subscription.status_change')
  setActive(@Param('id') id: string, @Param('isActive') isActive: string) {
    return this.webhooksService.setActive(id, isActive === 'true');
  }

  @Get('admin/webhooks/subscriptions/:id/logs')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  logs(@Param('id') id: string) {
    return this.webhooksService.getLogs(id);
  }

  /**
   * Test receiver — lets us verify the full outbound delivery chain
   * (signing, HTTP delivery, logging) by pointing a subscription at our
   * own app, since this sandbox can't reach a real external partner URL.
   * Not meant for production use.
   */
  @Post('webhooks/test-receiver')
  testReceiver(@Body() body: unknown) {
    return { received: true, body };
  }
}
