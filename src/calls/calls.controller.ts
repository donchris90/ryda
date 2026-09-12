import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { CallsService } from './calls.service';

@ApiTags('calls')
@Controller('calls')
@UseGuards(JwtAuthGuard)
export class CallsController {
  constructor(private readonly callsService: CallsService) {}

  /**
   * Fetched by the client right before starting or accepting a call, so
   * TURN credentials are always fresh rather than baked into the app
   * build. Actual call setup/teardown (invite, accept, offer, answer,
   * ICE candidates, end) all happens over the /tracking socket
   * namespace's ride:${rideId} room, not REST - see
   * TrackingGateway's call:* handlers.
   */
  @Get('ice-servers')
  getIceServers(@CurrentUser() user: User) {
    return this.callsService.getIceServers(user.id);
  }
}
