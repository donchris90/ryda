import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { User } from '../users/entities/user.entity';
import { FraudService } from './fraud.service';
import { RiskEngineService } from './risk-engine.service';
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
  constructor(
    private readonly fraudService: FraudService,
    private readonly riskEngineService: RiskEngineService,
  ) {}

  /** The Fraud page's top metric cards. */
  @Get('summary')
  summary() {
    return this.fraudService.getSummary();
  }

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

  /**
   * The Fraud Center's per-user detail view - risk score/band with
   * explainable reasons, every device this user has logged in from,
   * and accounts connected to them (shared device or a flag's own
   * relatedUserId). Composed here from RiskEngineService + FraudService
   * rather than making the frontend stitch together three separate
   * calls - it's one screen, showing one account's full fraud
   * picture, not three independent lists that happen to share a page.
   */
  @Get('profile/:userId')
  async profile(@Param('userId') userId: string) {
    const [risk, devices, relatedAccountIds] = await Promise.all([
      this.riskEngineService.assess(userId),
      this.fraudService.listDevicesForUser(userId),
      this.fraudService.findRelatedAccounts(userId),
    ]);
    return { risk, devices, relatedAccountIds };
  }

  @Patch('flags/:id/review')
  @Audit('fraud_flag.review')
  review(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: ReviewFlagDto) {
    return this.fraudService.reviewFlag(id, user.id, dto.status, dto.notes);
  }
}
