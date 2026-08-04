import { Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { User } from '../users/entities/user.entity';
import { DispatchService } from './dispatch.service';

@Controller('rides')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.DRIVER)
export class DispatchController {
  constructor(private readonly dispatchService: DispatchService) {}

  @Get(':id/my-offer')
  myOffer(@CurrentUser() user: User, @Param('id') rideId: string) {
    return this.dispatchService.getMyPendingOffer(rideId, user.id);
  }

  @Patch(':id/decline')
  decline(@CurrentUser() user: User, @Param('id') rideId: string) {
    return this.dispatchService.markDeclined(rideId, user.id);
  }
}
