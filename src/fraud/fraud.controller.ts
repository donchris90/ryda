import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { User } from '../users/entities/user.entity';
import { FraudService } from './fraud.service';
import { ReviewFlagDto } from './dto/fraud.dto';
import { FraudFlagStatus, FraudFlagType } from './entities/fraud-flag.entity';
import { RequirePermission } from '../common/permissions/require-permission.decorator';
import { PermissionsGuard } from '../common/permissions/permissions.guard';
import { Permission } from '../common/permissions/permission.enum';
import { Audit } from '../audit/decorators/audit.decorator';

@Controller('admin/fraud')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.SUPPORT_AGENT)
@RequirePermission(Permission.FRAUD_REVIEW)
export class FraudController {
  constructor(private readonly fraudService: FraudService) {}

  @Get('flags')
  list(
    @Query('type') type?: FraudFlagType,
    @Query('status') status?: FraudFlagStatus,
    @Query('userId') userId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.fraudService.listFlags({
      type,
      status,
      userId,
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
    });
  }

  @Patch('flags/:id/review')
  @Audit('fraud_flag.review')
  review(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: ReviewFlagDto) {
    return this.fraudService.reviewFlag(id, user.id, dto.status, dto.notes);
  }
}
