import { Body, Controller, Get, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { RequirePermission } from '../common/permissions/require-permission.decorator';
import { PermissionsGuard } from '../common/permissions/permissions.guard';
import { Permission } from '../common/permissions/permission.enum';
import { Audit } from '../audit/decorators/audit.decorator';
import { AdvertisingService } from './advertising.service';
import {
  CreateBannerAdDto,
  CreateCampaignDto,
  CreateSponsoredLocationDto,
} from './dto/advertising.dto';
import { BannerPlacement } from './entities/banner-ad.entity';
import { AdCampaignStatus } from './entities/ad-campaign.entity';

const ADMIN_ROLES = [UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.MARKETING];

@Controller()
export class AdvertisingController {
  constructor(private readonly advertisingService: AdvertisingService) {}

  // ---- Public: ad delivery ----

  @Get('ads/banners')
  activeBanners(@Query('placement') placement: BannerPlacement) {
    return this.advertisingService.listActiveBanners(placement);
  }

  @Post('ads/banners/:id/impression')
  async recordImpression(@Param('id') id: string) {
    await this.advertisingService.recordImpression(id);
    return { recorded: true };
  }

  /** Records the click and redirects to the target URL — what a mobile client's "open ad" tap would hit. */
  @Get('ads/banners/:id/click')
  async recordClick(@Param('id') id: string, @Res() res: Response) {
    const targetUrl = await this.advertisingService.recordClick(id);
    res.redirect(targetUrl);
  }

  @Get('ads/sponsored-locations/nearby')
  nearbySponsoredLocations(@Query('lat') lat: string, @Query('lng') lng: string) {
    return this.advertisingService.findNearbySponsoredLocations(parseFloat(lat), parseFloat(lng));
  }

  // ---- Admin/marketing: management ----

  @Get('admin/ads/campaigns')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles(...ADMIN_ROLES)
  @RequirePermission(Permission.ADS_MANAGE)
  listCampaigns() {
    return this.advertisingService.listCampaigns();
  }

  @Post('admin/ads/campaigns')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles(...ADMIN_ROLES)
  @RequirePermission(Permission.ADS_MANAGE)
  @Audit('ad_campaign.create')
  createCampaign(@Body() dto: CreateCampaignDto) {
    return this.advertisingService.createCampaign(dto);
  }

  @Patch('admin/ads/campaigns/:id/status/:status')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles(...ADMIN_ROLES)
  @RequirePermission(Permission.ADS_MANAGE)
  @Audit('ad_campaign.status_change')
  setCampaignStatus(@Param('id') id: string, @Param('status') status: AdCampaignStatus) {
    return this.advertisingService.setCampaignStatus(id, status);
  }

  @Get('admin/ads/banners')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles(...ADMIN_ROLES)
  @RequirePermission(Permission.ADS_MANAGE)
  listAllBanners() {
    return this.advertisingService.listAllBanners();
  }

  @Post('admin/ads/banners')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles(...ADMIN_ROLES)
  @RequirePermission(Permission.ADS_MANAGE)
  @Audit('banner_ad.create')
  createBanner(@Body() dto: CreateBannerAdDto) {
    return this.advertisingService.createBanner(dto);
  }

  @Patch('admin/ads/banners/:id/active/:isActive')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles(...ADMIN_ROLES)
  @RequirePermission(Permission.ADS_MANAGE)
  @Audit('banner_ad.status_change')
  setBannerActive(@Param('id') id: string, @Param('isActive') isActive: string) {
    return this.advertisingService.setBannerActive(id, isActive === 'true');
  }

  @Get('admin/ads/sponsored-locations')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles(...ADMIN_ROLES)
  @RequirePermission(Permission.ADS_MANAGE)
  listAllSponsoredLocations() {
    return this.advertisingService.listAllSponsoredLocations();
  }

  @Post('admin/ads/sponsored-locations')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles(...ADMIN_ROLES)
  @RequirePermission(Permission.ADS_MANAGE)
  @Audit('sponsored_location.create')
  createSponsoredLocation(@Body() dto: CreateSponsoredLocationDto) {
    return this.advertisingService.createSponsoredLocation(dto);
  }
}
