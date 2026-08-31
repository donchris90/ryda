import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { User } from '../users/entities/user.entity';
import { IncentivesService } from './incentives.service';
import { CreateIncentiveDto } from './dto/incentives.dto';
import { Audit } from '../audit/decorators/audit.decorator';

@Controller()
export class IncentivesController {
  constructor(private readonly incentivesService: IncentivesService) {}

  @Get('incentives')
  listActive() {
    return this.incentivesService.listActive();
  }

  @Get('incentives/mine')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.DRIVER)
  myProgress(@CurrentUser() user: User) {
    return this.incentivesService.getDriverProgress(user.id);
  }

  @Get('admin/incentives')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  listAll() {
    return this.incentivesService.listAll();
  }

  @Post('admin/incentives')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Audit('incentive.create')
  create(@Body() dto: CreateIncentiveDto) {
    return this.incentivesService.create(dto);
  }

  @Patch('admin/incentives/:id/active/:isActive')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Audit('incentive.status_change')
  setActive(@Param('id') id: string, @Param('isActive') isActive: string) {
    return this.incentivesService.setActive(id, isActive === 'true');
  }

  @Get('admin/incentives/:id/progress')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  progress(@Param('id') id: string) {
    return this.incentivesService.getProgressForIncentive(id);
  }
}
