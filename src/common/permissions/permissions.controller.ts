import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { RolesGuard } from '../guards/roles.guard';
import { Roles } from '../decorators/roles.decorator';
import { CurrentUser } from '../decorators/current-user.decorator';
import { UserRole } from '../enums/user-role.enum';
import { User } from '../../users/entities/user.entity';
import { getPermissionsForRole, ROLE_PERMISSIONS } from './permission.enum';

@Controller('permissions')
@UseGuards(JwtAuthGuard)
export class PermissionsController {
  @Get('mine')
  mine(@CurrentUser() user: User) {
    return { role: user.role, permissions: getPermissionsForRole(user.role) };
  }

  @Get('matrix')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  matrix() {
    return ROLE_PERMISSIONS;
  }

  @Get('roles/:role')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  forRole(@Param('role') role: string) {
    return { role, permissions: getPermissionsForRole(role) };
  }
}
