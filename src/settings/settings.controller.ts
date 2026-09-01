import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { User } from '../users/entities/user.entity';
import { SystemSettingsService } from './settings.service';
import { UpsertSettingDto } from './dto/settings.dto';
import { Audit } from '../audit/decorators/audit.decorator';
import {
  FeatureFlagsService,
  FEATURE_KEYS,
} from '../feature-flags/feature-flags.service';

/**
 * Genuinely public — no auth at all. Deliberately a separate controller
 * from SettingsController below rather than an exception carved out of
 * it, since that one is guarded at the class level and mixing an
 * unguarded route in would be an easy place for a future edit to
 * accidentally lose the admin restriction on everything else.
 */
@Controller('app-config')
export class AppConfigController {
  constructor(
    private readonly settingsService: SystemSettingsService,
    private readonly featureFlagsService: FeatureFlagsService,
    private readonly config: ConfigService,
  ) {}

  @Get('contact')
  getContactInfo() {
    return this.settingsService.getContactInfo();
  }

  /**
   * A small, deliberately-whitelisted subset of feature flags that
   * client apps need to know about to decide whether to show a UI
   * element at all (e.g. the "Pool" toggle on the ride-request screen).
   * Not a general passthrough of FeatureFlagsService.listAll() — that
   * stays admin-only in FeatureFlagsController, since flag names and
   * descriptions aren't meant for public consumption.
   */
  @Get('feature-flags')
  async getPublicFeatureFlags() {
    return {
      ridePoolingEnabled: await this.featureFlagsService.isEnabled(
        FEATURE_KEYS.RIDE_SHARING,
      ),
      ridePoolingDiscountFraction: this.config.get<number>(
        'pooling.discountFraction',
      ),
    };
  }
}

@Controller('admin/settings')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.COUNTRY_ADMIN)
export class SettingsController {
  constructor(private readonly settingsService: SystemSettingsService) {}

  @Get()
  list() {
    return this.settingsService.listAll();
  }

  @Put(':key')
  @Audit('system_setting.update')
  set(
    @CurrentUser() user: User,
    @Param('key') key: string,
    @Body() dto: UpsertSettingDto,
  ) {
    return this.settingsService.set(key, user.id, dto);
  }

  @Delete(':key')
  @Audit('system_setting.delete')
  delete(@Param('key') key: string) {
    return this.settingsService.delete(key);
  }
}
