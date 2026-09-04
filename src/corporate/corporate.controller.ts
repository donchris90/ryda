import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { User } from '../users/entities/user.entity';
import { CorporateService } from './corporate.service';
import { CorporateApprovalStatus } from './entities/corporate-ride-approval.entity';
import {
  AddEmployeeDto,
  CreateCorporateAccountDto,
  ReviewApprovalDto,
  TopUpBudgetDto,
  UpdateCorporatePolicyDto,
  UpdateEmployeeDto,
} from './dto/corporate.dto';

@Controller('corporate')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CorporateController {
  constructor(private readonly corporateService: CorporateService) {}

  @Post('accounts')
  @Roles(UserRole.CORPORATE)
  createAccount(@CurrentUser() user: User, @Body() dto: CreateCorporateAccountDto) {
    return this.corporateService.createAccount(user.id, dto.companyName, dto.initialBudget ?? 0);
  }

  @Get('accounts/mine')
  @Roles(UserRole.CORPORATE)
  myAccount(@CurrentUser() user: User) {
    return this.corporateService.findByOwner(user.id);
  }

  @Get('accounts/mine/transactions')
  @Roles(UserRole.CORPORATE)
  async myTransactions(@CurrentUser() user: User) {
    const account = await this.corporateService.findByOwner(user.id);
    return this.corporateService.listTransactions(account.id);
  }

  @Post('accounts/mine/employees')
  @Roles(UserRole.CORPORATE)
  async addEmployee(@CurrentUser() user: User, @Body() dto: AddEmployeeDto) {
    const account = await this.corporateService.findByOwner(user.id);
    return this.corporateService.addEmployee(account.id, dto.userId);
  }

  @Post('accounts/mine/topup')
  @Roles(UserRole.CORPORATE)
  async topUp(@CurrentUser() user: User, @Body() dto: TopUpBudgetDto) {
    const account = await this.corporateService.findByOwner(user.id);
    return this.corporateService.topUp(account.id, dto.amount, 'Manual budget top-up');
  }

  @Patch('accounts/mine/policy')
  @Roles(UserRole.CORPORATE)
  async updatePolicy(@CurrentUser() user: User, @Body() dto: UpdateCorporatePolicyDto) {
    const account = await this.corporateService.findByOwner(user.id);
    return this.corporateService.updatePolicy(account.id, dto);
  }

  @Patch('accounts/mine/employees/:userId')
  @Roles(UserRole.CORPORATE)
  async updateEmployee(@CurrentUser() user: User, @Param('userId') employeeUserId: string, @Body() dto: UpdateEmployeeDto) {
    const account = await this.corporateService.findByOwner(user.id);
    return this.corporateService.updateEmployee(account.id, employeeUserId, dto);
  }

  @Get('accounts/mine/reporting/by-employee')
  @Roles(UserRole.CORPORATE)
  async spendByEmployee(@CurrentUser() user: User) {
    const account = await this.corporateService.findByOwner(user.id);
    return this.corporateService.getSpendByEmployee(account.id);
  }

  @Get('accounts/mine/reporting/by-department')
  @Roles(UserRole.CORPORATE)
  async spendByDepartment(@CurrentUser() user: User) {
    const account = await this.corporateService.findByOwner(user.id);
    return this.corporateService.getSpendByDepartment(account.id);
  }

  @Get('accounts/mine/approvals')
  @Roles(UserRole.CORPORATE)
  async listApprovals(@CurrentUser() user: User) {
    const account = await this.corporateService.findByOwner(user.id);
    return this.corporateService.listApprovals(account.id);
  }

  @Patch('accounts/mine/approvals/:id')
  @Roles(UserRole.CORPORATE)
  async reviewApproval(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: ReviewApprovalDto) {
    const account = await this.corporateService.findByOwner(user.id);
    return this.corporateService.reviewApproval(
      account.id,
      id,
      user.id,
      dto.status === 'approved' ? CorporateApprovalStatus.APPROVED : CorporateApprovalStatus.REJECTED,
      dto.notes,
    );
  }

  @Get('admin/accounts')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  adminListAll() {
    return this.corporateService.listForAdmin();
  }

  @Patch('admin/accounts/:id/active/:isActive')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  adminSetActive(@Param('id') id: string, @Param('isActive') isActive: string) {
    return this.corporateService.setActive(id, isActive === 'true');
  }
}
