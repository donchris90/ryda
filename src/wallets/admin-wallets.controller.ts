import { Body, Controller, Get, NotFoundException, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { WalletsService } from './wallets.service';
import { AdminCreditWalletDto } from './dto/admin-credit-wallet.dto';
import { TransactionCategory } from '../common/enums/transaction.enum';
import { Audit } from '../audit/decorators/audit.decorator';

@Controller('admin/wallets')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.COUNTRY_ADMIN)
export class AdminWalletsController {
  constructor(
    private readonly usersService: UsersService,
    private readonly walletsService: WalletsService,
  ) {}

  // Deliberately a separate step from credit() itself - the admin
  // dashboard uses this to show the real account holder's name and
  // current balance before the actual credit happens, so an admin
  // confirms it's genuinely the right person before real money moves.
  @Get('lookup')
  async lookup(@Query('email') email: string) {
    const user = await this.usersService.findByEmail(email);
    if (!user) throw new NotFoundException('No Ryda account found with that email address');
    const wallet = await this.walletsService.getByUserId(user.id);
    return {
      userId: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role: user.role,
      currentBalance: wallet.balance,
    };
  }

  @Post('credit')
  @Audit('wallet.admin_credit')
  async credit(@CurrentUser() admin: User, @Body() dto: AdminCreditWalletDto) {
    const user = await this.usersService.findByEmail(dto.email);
    if (!user) throw new NotFoundException('No Ryda account found with that email address');
    const wallet = await this.walletsService.getByUserId(user.id);

    return this.walletsService.credit(
      wallet.id,
      dto.amount,
      TransactionCategory.ADMIN_ADJUSTMENT,
      undefined,
      dto.reason ? `Admin credit by ${admin.email}: ${dto.reason}` : `Admin credit by ${admin.email}`,
    );
  }
}
