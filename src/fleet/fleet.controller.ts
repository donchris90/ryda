import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { User } from '../users/entities/user.entity';
import { FleetService } from './fleet.service';
import {
  AddFleetManagerDto,
  AssignDriverDto,
  AssignVehicleDto,
  CreateFleetCompanyDto,
  RequestPayoutDto,
} from './dto/fleet.dto';

@Controller('fleet')
@UseGuards(JwtAuthGuard)
export class FleetController {
  constructor(private readonly fleetService: FleetService) {}

  @Post('companies')
  @UseGuards(RolesGuard)
  @Roles(UserRole.FLEET_OWNER)
  createCompany(@CurrentUser() user: User, @Body() dto: CreateFleetCompanyDto) {
    return this.fleetService.createCompany(user.id, dto);
  }

  @Get('companies/mine')
  myCompany(@CurrentUser() user: User) {
    return this.fleetService.getCompanyForStaff(user.id);
  }

  @Post('companies/mine/managers')
  async addManager(@CurrentUser() user: User, @Body() dto: AddFleetManagerDto) {
    const company = await this.fleetService.getCompanyForStaff(user.id);
    return this.fleetService.addManager(company.id, user.id, dto.userId);
  }

  @Post('companies/mine/drivers')
  async assignDriver(@CurrentUser() user: User, @Body() dto: AssignDriverDto) {
    const company = await this.fleetService.getCompanyForStaff(user.id);
    await this.fleetService.assignDriver(company.id, user.id, dto.driverUserId);
    return { assigned: true };
  }

  @Post('companies/mine/drivers/remove')
  async removeDriver(@CurrentUser() user: User, @Body() dto: AssignDriverDto) {
    const company = await this.fleetService.getCompanyForStaff(user.id);
    await this.fleetService.removeDriver(company.id, user.id, dto.driverUserId);
    return { removed: true };
  }

  @Get('companies/mine/drivers')
  async listDrivers(@CurrentUser() user: User) {
    const company = await this.fleetService.getCompanyForStaff(user.id);
    return this.fleetService.listDrivers(company.id);
  }

  @Post('companies/mine/vehicles')
  async assignVehicle(@CurrentUser() user: User, @Body() dto: AssignVehicleDto) {
    const company = await this.fleetService.getCompanyForStaff(user.id);
    await this.fleetService.assignVehicle(company.id, user.id, dto.vehicleId);
    return { assigned: true };
  }

  @Get('companies/mine/vehicles')
  async listVehicles(@CurrentUser() user: User) {
    const company = await this.fleetService.getCompanyForStaff(user.id);
    return this.fleetService.listVehicles(company.id);
  }

  @Get('companies/mine/wallet')
  async wallet(@CurrentUser() user: User) {
    const company = await this.fleetService.getCompanyForStaff(user.id);
    return this.fleetService.getWallet(company.id);
  }

  @Get('companies/mine/wallet/transactions')
  async walletTransactions(@CurrentUser() user: User) {
    const company = await this.fleetService.getCompanyForStaff(user.id);
    return this.fleetService.listTransactions(company.id);
  }

  @Post('companies/mine/payouts')
  async requestPayout(@CurrentUser() user: User, @Body() dto: RequestPayoutDto) {
    const company = await this.fleetService.getCompanyForStaff(user.id);
    return this.fleetService.requestPayout(
      company.id,
      user.id,
      dto.amount,
      dto.bankAccountNumber,
      dto.bankCode,
    );
  }

  @Get('companies/mine/payouts')
  async listPayouts(@CurrentUser() user: User) {
    const company = await this.fleetService.getCompanyForStaff(user.id);
    return this.fleetService.listPayouts(company.id);
  }

  @Get('companies/mine/analytics')
  async analytics(@CurrentUser() user: User) {
    const company = await this.fleetService.getCompanyForStaff(user.id);
    return this.fleetService.getAnalytics(company.id);
  }

  @Get('admin/companies')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  adminListAll() {
    return this.fleetService.listForAdmin();
  }

  @Patch('admin/companies/:id/active/:isActive')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  adminSetActive(@Param('id') id: string, @Param('isActive') isActive: string) {
    return this.fleetService.setActive(id, isActive === 'true');
  }
}
