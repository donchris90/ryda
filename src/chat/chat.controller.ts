import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { ChatService } from './chat.service';
import { SendRideMessageDto } from './dto/send-ride-message.dto';

@Controller('rides/:rideId/messages')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post()
  send(@Param('rideId') rideId: string, @CurrentUser() user: User, @Body() dto: SendRideMessageDto) {
    return this.chatService.sendMessage(rideId, user.id, dto.message);
  }

  @Get()
  list(@Param('rideId') rideId: string, @CurrentUser() user: User) {
    return this.chatService.getMessages(rideId, user.id);
  }
}
