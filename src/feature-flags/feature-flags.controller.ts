import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { User } from '../users/entities/user.entity';
import { FeatureFlagsService } from './feature-flags.service';
import { UpsertFeatureFlagDto } from './dto/feature-flag.dto';
import { Audit } from '../audit/decorators/audit.decorator';

@Controller('admin/feature-flags')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
export class FeatureFlagsController {
  constructor(private readonly featureFlagsService: FeatureFlagsService) {}

  @Get()
  list() {
    return this.featureFlagsService.listAll();
  }

  @Put(':key')
  @Audit('feature_flag.update')
  upsert(@CurrentUser() user: User, @Param('key') key: string, @Body() dto: UpsertFeatureFlagDto) {
    return this.featureFlagsService.upsert(key, user.id, dto);
  }
}
