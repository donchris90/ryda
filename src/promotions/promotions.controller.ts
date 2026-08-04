import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { User } from '../users/entities/user.entity';
import { PromotionsService } from './promotions.service';
import { CreateCampaignDto, CreatePromotionDto, ValidatePromoDto } from './dto/promotions.dto';
import { Audit } from '../audit/decorators/audit.decorator';
import { RequirePermission } from '../common/permissions/require-permission.decorator';
import { PermissionsGuard } from '../common/permissions/permissions.guard';
import { Permission } from '../common/permissions/permission.enum';

@Controller()
export class PromotionsController {
  constructor(private readonly promotionsService: PromotionsService) {}

  @Post('promotions/validate')
  @UseGuards(JwtAuthGuard)
  validate(@CurrentUser() user: User, @Body() dto: ValidatePromoDto) {
    return this.promotionsService.validate(dto.code, user.id, dto.fareAmount);
  }

  @Get('promotions/referrals/mine')
  @UseGuards(JwtAuthGuard)
  myReferrals(@CurrentUser() user: User) {
    return this.promotionsService.getReferralSummary(user.id);
  }

  @Get('admin/promotions')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MARKETING, UserRole.SUPER_ADMIN)
  list() {
    return this.promotionsService.listPromotions();
  }

  @Post('admin/promotions')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles(UserRole.ADMIN, UserRole.MARKETING, UserRole.SUPER_ADMIN)
  @RequirePermission(Permission.PROMOTIONS_MANAGE)
  @Audit('promotion.create')
  create(@Body() dto: CreatePromotionDto) {
    return this.promotionsService.createPromotion(dto);
  }

  @Patch('admin/promotions/:id/active/:isActive')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles(UserRole.ADMIN, UserRole.MARKETING, UserRole.SUPER_ADMIN)
  @RequirePermission(Permission.PROMOTIONS_MANAGE)
  @Audit('promotion.status_change')
  setActive(@Param('id') id: string, @Param('isActive') isActive: string) {
    return this.promotionsService.setActive(id, isActive === 'true');
  }

  @Get('admin/campaigns')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MARKETING, UserRole.SUPER_ADMIN)
  listCampaigns() {
    return this.promotionsService.listCampaigns();
  }

  @Post('admin/campaigns')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MARKETING, UserRole.SUPER_ADMIN)
  createCampaign(@Body() dto: CreateCampaignDto) {
    return this.promotionsService.createCampaign(dto);
  }
}
