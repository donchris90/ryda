import { Body, Controller, Get, Param, Patch, Post, Query, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from './entities/user.entity';
import { UserRole } from '../common/enums/user-role.enum';
import { UsersService } from './users.service';
import { StorageService } from '../storage/storage.service';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly storageService: StorageService,
  ) {}

  @Get('me')
  getProfile(@CurrentUser() user: User) {
    return this.usersService.sanitize(user);
  }

  @Post('me/profile-photo')
  @UseInterceptors(FileInterceptor('file'))
  async uploadProfilePhoto(@CurrentUser() user: User, @UploadedFile() file: Express.Multer.File) {
    const { url } = await this.storageService.upload(
      { buffer: file.buffer, originalname: file.originalname, mimetype: file.mimetype },
      'profile-photos',
    );
    const updated = await this.usersService.setProfilePhoto(user.id, url);
    return this.usersService.sanitize(updated);
  }

  @Get('admin/list')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.COUNTRY_ADMIN, UserRole.CITY_MANAGER, UserRole.SUPPORT_AGENT, UserRole.FINANCE, UserRole.AUDITOR)
  listForAdmin(
    @Query('role') role?: UserRole,
    @Query('isActive') isActive?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.usersService.listForAdmin(
      { role, isActive: isActive === undefined ? undefined : isActive === 'true', search },
      page ? parseInt(page, 10) : undefined,
      limit ? parseInt(limit, 10) : undefined,
    );
  }

  @Patch('admin/:id/active/:isActive')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.COUNTRY_ADMIN, UserRole.CITY_MANAGER)
  async setActive(@Param('id') id: string, @Param('isActive') isActive: string) {
    const updated = await this.usersService.setActive(id, isActive === 'true');
    return this.usersService.sanitize(updated);
  }
}
