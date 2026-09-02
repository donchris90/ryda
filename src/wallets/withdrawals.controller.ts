import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
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

  @Get('bank-accounts')
  listBankAccounts(@CurrentUser() user: User) {
    return this.withdrawalsService.listBankAccounts(user.id);
  }

  @Post('bank-accounts')
  addBankAccount(@CurrentUser() user: User, @Body() dto: AddBankAccountDto) {
    return this.withdrawalsService.addBankAccount(user.id, dto);
  }

  @Delete('bank-accounts/:id')
  removeBankAccount(@CurrentUser() user: User, @Param('id') id: string) {
    return this.withdrawalsService.removeBankAccount(user.id, id);
  }

  @Post('withdraw/initiate')
  initiateWithdrawal(@CurrentUser() user: User, @Body() dto: RequestWithdrawalDto) {
    return this.withdrawalsService.initiateWithdrawal(user.id, dto.bankAccountId, dto.amount);
  }

  @Post('withdraw/confirm')
  confirmWithdrawal(@CurrentUser() user: User, @Body() dto: ConfirmWithdrawalDto) {
    return this.withdrawalsService.confirmWithdrawal(user.id, dto.withdrawalRequestId, dto.otpCode);
  }

  @Get('withdrawals/mine')
  listWithdrawals(@CurrentUser() user: User) {
    return this.withdrawalsService.listWithdrawals(user.id);
  }
}
