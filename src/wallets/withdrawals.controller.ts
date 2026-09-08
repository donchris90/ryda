import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../common/enums/user-role.enum';
import { WithdrawalsService } from './withdrawals.service';
import { AddBankAccountDto, RequestWithdrawalDto, ConfirmWithdrawalDto } from './dto/withdrawals.dto';

@Controller('wallet')
@UseGuards(JwtAuthGuard)
export class WithdrawalsController {
  constructor(private readonly withdrawalsService: WithdrawalsService) {}

  @Get('banks')
  listBanks() {
    return this.withdrawalsService.listBanks();
  }

  // Everything below moves real money out of the platform to a bank
  // account - restricted to drivers, who are the only role with a
  // legitimate reason to withdraw (earned trip income). A passenger's
  // wallet balance only ever comes from top-ups, refunds, or promo
  // credit, never earned income - letting a passenger withdraw at all
  // is exactly the shape of a card-fraud cash-out path (fund the
  // wallet with a stolen card, then "withdraw" the balance to a real
  // bank account), not a legitimate feature gap.
  @UseGuards(RolesGuard)
  @Roles(UserRole.DRIVER)
  @Get('bank-accounts')
  listBankAccounts(@CurrentUser() user: User) {
    return this.withdrawalsService.listBankAccounts(user.id);
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.DRIVER)
  @Post('bank-accounts')
  addBankAccount(@CurrentUser() user: User, @Body() dto: AddBankAccountDto) {
    return this.withdrawalsService.addBankAccount(user.id, dto);
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.DRIVER)
  @Delete('bank-accounts/:id')
  removeBankAccount(@CurrentUser() user: User, @Param('id') id: string) {
    return this.withdrawalsService.removeBankAccount(user.id, id);
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.DRIVER)
  @Post('withdraw/initiate')
  initiateWithdrawal(@CurrentUser() user: User, @Body() dto: RequestWithdrawalDto) {
    return this.withdrawalsService.initiateWithdrawal(user.id, dto.bankAccountId, dto.amount);
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.DRIVER)
  @Post('withdraw/confirm')
  confirmWithdrawal(@CurrentUser() user: User, @Body() dto: ConfirmWithdrawalDto) {
    return this.withdrawalsService.confirmWithdrawal(user.id, dto.withdrawalRequestId, dto.otpCode);
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.DRIVER)
  @Get('withdrawals/mine')
  listWithdrawals(@CurrentUser() user: User) {
    return this.withdrawalsService.listWithdrawals(user.id);
  }
}
