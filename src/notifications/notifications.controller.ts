import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { User } from '../users/entities/user.entity';
import { NotificationsService } from './notifications.service';
import { BroadcastDto, RegisterDeviceTokenDto } from './dto/notifications.dto';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get('mine')
  mine(@CurrentUser() user: User) {
    return this.notificationsService.listForUser(user.id);
  }

  @Get('mine/unread-count')
  unreadCount(@CurrentUser() user: User) {
    return this.notificationsService.unreadCount(user.id);
  }

  @Patch(':id/read')
  markRead(@CurrentUser() user: User, @Param('id') id: string) {
    return this.notificationsService.markRead(user.id, id);
  }

  @Patch('mine/read-all')
  markAllRead(@CurrentUser() user: User) {
    return this.notificationsService.markAllRead(user.id);
  }

  @Post('devices')
  registerDevice(@CurrentUser() user: User, @Body() dto: RegisterDeviceTokenDto) {
    return this.notificationsService.registerDeviceToken(user.id, dto.token, dto.platform);
  }

  @Delete('devices/:token')
  removeDevice(@CurrentUser() user: User, @Param('token') token: string) {
    return this.notificationsService.removeDeviceToken(user.id, token);
  }

  /** Admin/marketing broadcast — e.g. CMS announcements, campaign pushes. */
  @Post('broadcast')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MARKETING, UserRole.SUPER_ADMIN)
  async broadcast(@Body() dto: BroadcastDto) {
    const results = await Promise.all(
      dto.userIds.map((userId) =>
        this.notificationsService.notify(userId, [dto.channel], dto.title, dto.body),
      ),
    );
    return { sentTo: results.length };
  }
}
