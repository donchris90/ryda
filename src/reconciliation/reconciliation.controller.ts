import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { User } from '../users/entities/user.entity';
import { ReconciliationService } from './reconciliation.service';
import { WriteOffDto } from './dto/reconciliation.dto';
import { Audit } from '../audit/decorators/audit.decorator';

@Controller()
@UseGuards(JwtAuthGuard)
export class ReconciliationController {
  constructor(private readonly reconciliationService: ReconciliationService) {}

  @Get('reconciliation/mine')
  @UseGuards(RolesGuard)
  @Roles(UserRole.DRIVER)
  async mine(@CurrentUser() user: User) {
    const [summary, items] = await Promise.all([
      this.reconciliationService.getOutstandingBalance(user.id),
      this.reconciliationService.listForDriver(user.id),
    ]);
    return { summary, items };
  }

  @Get('admin/reconciliation/summary')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.FINANCE)
  summary() {
    return this.reconciliationService.getSummary();
  }

  @Get('admin/reconciliation/pending')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.FINANCE)
  listPending() {
    return this.reconciliationService.listAllPending();
  }

  @Get('admin/reconciliation/driver/:driverId')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.FINANCE)
  async forDriver(@Param('driverId') driverId: string) {
    const [summary, items] = await Promise.all([
      this.reconciliationService.getOutstandingBalance(driverId),
      this.reconciliationService.listForDriver(driverId),
    ]);
    return { summary, items };
  }

  @Patch('admin/reconciliation/:id/write-off')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.FINANCE)
  @Audit('reconciliation.write_off')
  writeOff(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: WriteOffDto) {
    return this.reconciliationService.writeOff(id, user.id, dto.reason);
  }

  /**
   * Manually re-runs the same oldest-first settlement sweep that normally
   * fires automatically off the `wallet.updated` event — useful when an
   * admin wants to retry immediately after e.g. investigating a driver's
   * balance, instead of waiting for their next wallet credit to trigger it.
   * Reuses ReconciliationService.attemptSettle() directly; no new
   * settlement logic here.
   */
  @Post('admin/reconciliation/driver/:driverId/attempt-settle')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.FINANCE)
  @Audit('reconciliation.attempt_settle')
  attemptSettle(@Param('driverId') driverId: string) {
    return this.reconciliationService.attemptSettle(driverId);
  }
}
