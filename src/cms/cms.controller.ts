import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { CmsService } from './cms.service';
import { CreateAnnouncementDto, UpsertPageDto } from './dto/cms.dto';
import { Audit } from '../audit/decorators/audit.decorator';

@Controller()
export class CmsController {
  constructor(private readonly cmsService: CmsService) {}

  // ---- Public ----

  @Get('cms/pages/:slug')
  getPage(@Param('slug') slug: string) {
    return this.cmsService.getPublishedPage(slug);
  }

  @Get('cms/announcements')
  activeAnnouncements() {
    return this.cmsService.listActiveAnnouncements();
  }

  // ---- Admin ----

  @Get('admin/cms/pages')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.MARKETING)
  listAllPages() {
    return this.cmsService.listAllPages();
  }

  @Post('admin/cms/pages/:slug')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.MARKETING)
  @Audit('cms_page.upsert')
  upsertPage(@Param('slug') slug: string, @Body() dto: UpsertPageDto) {
    return this.cmsService.upsertPage(slug, dto);
  }

  @Get('admin/cms/announcements')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.MARKETING)
  listAllAnnouncements() {
    return this.cmsService.listAllAnnouncements();
  }

  @Post('admin/cms/announcements')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.MARKETING)
  @Audit('announcement.create')
  createAnnouncement(@Body() dto: CreateAnnouncementDto) {
    return this.cmsService.createAnnouncement(dto);
  }

  @Patch('admin/cms/announcements/:id/active/:isActive')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.MARKETING)
  @Audit('announcement.status_change')
  setAnnouncementActive(@Param('id') id: string, @Param('isActive') isActive: string) {
    return this.cmsService.setAnnouncementActive(id, isActive === 'true');
  }
}
