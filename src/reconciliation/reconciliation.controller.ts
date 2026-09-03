import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { User } from '../users/entities/user.entity';
import { ReconciliationService } from './reconciliation.service';
import { LedgerAuditService } from './ledger-audit.service';
import { LedgerAccountType } from './entities/ledger-discrepancy.entity';
import { WriteOffDto, ResolveDiscrepancyDto } from './dto/reconciliation.dto';
import { Audit } from '../audit/decorators/audit.decorator';

@Controller()
@UseGuards(JwtAuthGuard)
export class ReconciliationController {
  constructor(
    private readonly reconciliationService: ReconciliationService,
    private readonly ledgerAuditService: LedgerAuditService,
  ) {}

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

  @Post('admin/ledger-audit/scan')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.FINANCE)
  @Audit('ledger_audit.manual_scan')
  runScan() {
    return this.ledgerAuditService.runQuickScan();
  }

  @Post('admin/ledger-audit/scan/fleet')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.FINANCE)
  @Audit('ledger_audit.manual_scan_fleet')
  runFleetScan() {
    return this.ledgerAuditService.runFleetWalletScan();
  }

  @Post('admin/ledger-audit/scan/corporate')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.FINANCE)
  @Audit('ledger_audit.manual_scan_corporate')
  runCorporateScan() {
    return this.ledgerAuditService.runCorporateAccountScan();
  }

  @Get('admin/ledger-audit/discrepancies')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.FINANCE)
  listDiscrepancies() {
    return this.ledgerAuditService.listOpenDiscrepancies();
  }

  @Get('admin/ledger-audit/wallet/:walletId')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.FINANCE)
  checkWallet(@Param('walletId') walletId: string, @Query('accountType') accountType?: LedgerAccountType) {
    return this.ledgerAuditService.checkWalletChain(walletId, accountType);
  }

  @Patch('admin/ledger-audit/discrepancies/:id/resolve')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.FINANCE)
  @Audit('ledger_audit.resolve_discrepancy')
  resolveDiscrepancy(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: ResolveDiscrepancyDto) {
    return this.ledgerAuditService.resolve(id, user.id, dto.note);
  }
}
