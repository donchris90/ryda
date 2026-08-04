import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { User } from '../users/entities/user.entity';
import { CorporateService } from './corporate.service';
import { AddEmployeeDto, CreateCorporateAccountDto, TopUpBudgetDto } from './dto/corporate.dto';

@Controller('corporate')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.CORPORATE)
export class CorporateController {
  constructor(private readonly corporateService: CorporateService) {}

  @Post('accounts')
  createAccount(@CurrentUser() user: User, @Body() dto: CreateCorporateAccountDto) {
    return this.corporateService.createAccount(user.id, dto.companyName, dto.initialBudget ?? 0);
  }

  @Get('accounts/mine')
  myAccount(@CurrentUser() user: User) {
    return this.corporateService.findByOwner(user.id);
  }

  @Get('accounts/mine/transactions')
  async myTransactions(@CurrentUser() user: User) {
    const account = await this.corporateService.findByOwner(user.id);
    return this.corporateService.listTransactions(account.id);
  }

  @Post('accounts/mine/employees')
  async addEmployee(@CurrentUser() user: User, @Body() dto: AddEmployeeDto) {
    const account = await this.corporateService.findByOwner(user.id);
    return this.corporateService.addEmployee(account.id, dto.userId);
  }

  @Post('accounts/mine/topup')
  async topUp(@CurrentUser() user: User, @Body() dto: TopUpBudgetDto) {
    const account = await this.corporateService.findByOwner(user.id);
    return this.corporateService.topUp(account.id, dto.amount, 'Manual budget top-up');
  }
}
