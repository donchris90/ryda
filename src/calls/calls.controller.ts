import { Body, Controller, Header, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { CallsService } from './calls.service';

@ApiTags('calls')
@Controller()
export class CallsController {
  constructor(private readonly callsService: CallsService) {}

  @Post('rides/:id/call')
  @UseGuards(JwtAuthGuard)
  initiateCall(@Param('id') id: string, @CurrentUser() user: User) {
    return this.callsService.initiateMaskedCall(id, user.id, user.role);
  }

  /**
   * Africa's Talking Voice callback — configured once in the AT
   * dashboard against this exact path. Public by necessity (AT is the
   * caller, not a logged-in user), same as the Paystack webhook
   * receiver in PaymentsController. Protected instead by a shared
   * secret query param set at registration time, since AT Voice
   * callbacks aren't HMAC-signed the way Paystack's are.
   */
  @ApiExcludeEndpoint()
  @Post('calls/webhook/voice')
  @Header('Content-Type', 'text/xml')
  async voiceCallback(@Query('secret') secret: string, @Body() body: Record<string, string>) {
    if (secret !== process.env.AFRICAS_TALKING_VOICE_WEBHOOK_SECRET) {
      return '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
    }
    return this.callsService.voiceCallback(body);
  }
}
