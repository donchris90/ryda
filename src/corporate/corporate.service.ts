import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CorporateAccount } from './entities/corporate-account.entity';
import { CorporateEmployee } from './entities/corporate-employee.entity';
import { CorporateTransaction } from './entities/corporate-transaction.entity';
import { CorporateRideApproval, CorporateApprovalStatus } from './entities/corporate-ride-approval.entity';
import { CorporateInvoice } from './entities/corporate-invoice.entity';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Cron, CronExpression } from '@nestjs/schedule';
import { TransactionDirection } from '../common/enums/transaction.enum';
import { RideCategory } from '../common/enums/ride.enum';
import { UsersService } from '../users/users.service';

@Injectable()
export class CorporateService {
  constructor(
    @InjectRepository(CorporateAccount)
    private readonly accountsRepo: Repository<CorporateAccount>,
    @InjectRepository(CorporateEmployee)
    private readonly employeesRepo: Repository<CorporateEmployee>,
    @InjectRepository(CorporateTransaction)
    private readonly txRepo: Repository<CorporateTransaction>,
    private readonly usersService: UsersService,
    @InjectRepository(CorporateRideApproval)
    private readonly approvalsRepo: Repository<CorporateRideApproval>,
    @InjectRepository(CorporateInvoice)
    private readonly invoicesRepo: Repository<CorporateInvoice>,
    private readonly events: EventEmitter2,
  ) {}

  async createAccount(
    ownerUserId: string,
    companyName: string,
    initialBudget = 0,
  ): Promise<CorporateAccount> {
    const account = this.accountsRepo.create({
      ownerUserId,
      companyName,
      budgetBalance: initialBudget.toFixed(2),
    });
    return this.accountsRepo.save(account);
  }

  async findByOwner(ownerUserId: string): Promise<CorporateAccount> {
    const account = await this.accountsRepo.findOne({ where: { ownerUserId } });
    if (!account) throw new NotFoundException('Corporate account not found');
    return account;
  }

  async findById(id: string): Promise<CorporateAccount> {
    const account = await this.accountsRepo.findOne({ where: { id } });
    if (!account) throw new NotFoundException('Corporate account not found');
    return account;
  }

  /**
   * Configurable ride rules - allowed categories, max fare, operating
   * hours, allowed cities - checked against one proposed ride, not
   * recomputed from scratch. Every dimension defaults to unrestricted
   * (null on the account = no rule set), so an account with no policy
   * configured never blocks anything - this only ever gets stricter
   * than that when an owner actually sets a rule.
   */
  checkRidePolicy(
    account: CorporateAccount,
    ride: { category: RideCategory; estimatedFare: number; city?: string | null; requestedAt: Date },
  ): { allowed: boolean; reason?: string } {
    if (account.allowedCategories && !account.allowedCategories.includes(ride.category)) {
      return { allowed: false, reason: `Your company doesn't allow booking ${ride.category} rides` };
    }

    if (account.maxFarePerRide != null && ride.estimatedFare > parseFloat(account.maxFarePerRide)) {
      return { allowed: false, reason: `This ride's estimated fare exceeds your company's per-ride limit of ₦${account.maxFarePerRide}` };
    }

    if (account.allowedCities && ride.city && !account.allowedCities.includes(ride.city)) {
      return { allowed: false, reason: `Your company doesn't allow corporate rides in ${ride.city}` };
    }

    if (account.operatingHoursStart != null && account.operatingHoursEnd != null) {
      const hour = ride.requestedAt.getHours();
      const { operatingHoursStart: start, operatingHoursEnd: end } = account;
      // A window that crosses midnight (e.g. 22 -> 6) means "outside"
      // is the gap in the MIDDLE (7am-9pm), not the wraparound at the
      // end of the day - inverting the usual start<=hour<end check for
      // that case, rather than requiring two separate policy fields.
      const withinWindow = start <= end ? hour >= start && hour < end : hour >= start || hour < end;
      if (!withinWindow) {
        return { allowed: false, reason: `Your company only allows corporate rides between ${start}:00 and ${end}:00` };
      }
    }

    return { allowed: true };
  }

  /** Owner-configurable, one field at a time via a partial patch - never required to resend the whole policy just to change one rule. */
  async updatePolicy(
    accountId: string,
    patch: {
      allowedCategories?: RideCategory[] | null;
      maxFarePerRide?: number | null;
      operatingHoursStart?: number | null;
      operatingHoursEnd?: number | null;
      allowedCities?: string[] | null;
    },
  ): Promise<CorporateAccount> {
    const account = await this.findById(accountId);
    if (patch.allowedCategories !== undefined) account.allowedCategories = patch.allowedCategories;
    if (patch.maxFarePerRide !== undefined) {
      account.maxFarePerRide = patch.maxFarePerRide != null ? patch.maxFarePerRide.toFixed(2) : null;
    }
    if (patch.operatingHoursStart !== undefined) account.operatingHoursStart = patch.operatingHoursStart;
    if (patch.operatingHoursEnd !== undefined) account.operatingHoursEnd = patch.operatingHoursEnd;
    if (patch.allowedCities !== undefined) account.allowedCities = patch.allowedCities;
    return this.accountsRepo.save(account);
  }

  async addEmployee(accountId: string, userId: string): Promise<CorporateEmployee> {
    await this.findById(accountId); // ensures account exists
    await this.usersService.findById(userId); // ensures user exists

    const existing = await this.employeesRepo.findOne({ where: { userId } });
    if (existing) {
      throw new ConflictException('User already belongs to a corporate account');
    }

    const employee = this.employeesRepo.create({ corporateAccountId: accountId, userId });
    return this.employeesRepo.save(employee);
  }

  /** Owner sets/clears an employee's department and/or monthly spend limit - one field at a time, same partial-patch shape as updatePolicy(). */
  async updateEmployee(
    accountId: string,
    employeeUserId: string,
    patch: { department?: string | null; monthlySpendLimit?: number | null },
  ): Promise<CorporateEmployee> {
    const employee = await this.employeesRepo.findOne({ where: { userId: employeeUserId, corporateAccountId: accountId } });
    if (!employee) throw new NotFoundException('This user is not an employee of your corporate account');

    if (patch.department !== undefined) employee.department = patch.department;
    if (patch.monthlySpendLimit !== undefined) {
      employee.monthlySpendLimit = patch.monthlySpendLimit != null ? patch.monthlySpendLimit.toFixed(2) : null;
    }
    return this.employeesRepo.save(employee);
  }

  /**
   * Checked at ride-request time (RidesService.requestRide()), same
   * as the account-wide checkRidePolicy() - a limit that only blocked
   * settlement after the ride already happened wouldn't actually
   * prevent anything. Sums this employee's own DEBIT transactions
   * since the start of the current calendar month; a null limit
   * (never configured) always passes.
   */
  async checkEmployeeSpendLimit(
    employeeUserId: string,
    additionalAmount: number,
  ): Promise<{ allowed: boolean; reason?: string }> {
    const employee = await this.employeesRepo.findOne({ where: { userId: employeeUserId } });
    if (!employee?.monthlySpendLimit) return { allowed: true };

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const { total } = await this.txRepo
      .createQueryBuilder('tx')
      .select('COALESCE(SUM(tx.amount), 0)', 'total')
      .where('tx.employeeUserId = :employeeUserId', { employeeUserId })
      .andWhere('tx.direction = :direction', { direction: TransactionDirection.DEBIT })
      .andWhere('tx.createdAt >= :startOfMonth', { startOfMonth })
      .getRawOne();

    const spentSoFar = parseFloat(total);
    const limit = parseFloat(employee.monthlySpendLimit);
    if (spentSoFar + additionalAmount > limit) {
      return { allowed: false, reason: `This ride would exceed your monthly spend limit of ₦${employee.monthlySpendLimit}` };
    }
    return { allowed: true };
  }

  /** Reporting - spend broken down by employee, for one account. Includes employees with zero transactions? No - only employees who've actually spent something, same reasoning as a bank statement not listing every account you could theoretically have transacted with. */
  async getSpendByEmployee(accountId: string) {
    return this.txRepo
      .createQueryBuilder('tx')
      .select('tx.employeeUserId', 'employeeUserId')
      .addSelect('COUNT(*)', 'transactionCount')
      .addSelect('COALESCE(SUM(tx.amount), 0)', 'totalSpent')
      .where('tx.corporateAccountId = :accountId', { accountId })
      .andWhere('tx.direction = :direction', { direction: TransactionDirection.DEBIT })
      .andWhere('tx.employeeUserId IS NOT NULL')
      .groupBy('tx.employeeUserId')
      .orderBy('"totalSpent"', 'DESC')
      .getRawMany();
  }

  /** Same shape as getSpendByEmployee(), grouped by department instead - an employee with no department set is simply absent from this list, not lumped into a misleading "unassigned" bucket. */
  async getSpendByDepartment(accountId: string) {
    return this.txRepo
      .createQueryBuilder('tx')
      .select('tx.department', 'department')
      .addSelect('COUNT(*)', 'transactionCount')
      .addSelect('COALESCE(SUM(tx.amount), 0)', 'totalSpent')
      .where('tx.corporateAccountId = :accountId', { accountId })
      .andWhere('tx.direction = :direction', { direction: TransactionDirection.DEBIT })
      .andWhere('tx.department IS NOT NULL')
      .groupBy('tx.department')
      .orderBy('"totalSpent"', 'DESC')
      .getRawMany();
  }

  /**
   * The balance the account was actually sitting at just before a
   * given instant - not looked up on the account row itself (which
   * only ever holds the CURRENT balance), but derived from the most
   * recent transaction's own balanceAfter strictly before that point.
   * Falls back to '0.00' for an instant before the account's very
   * first transaction ever landed (a brand-new, never-yet-funded
   * account), which is the only case with no transaction to derive it
   * from. Invoice generation is a low-volume, scheduled operation, not
   * a hot path, so a straightforward query here is the right call
   * over anything cleverer.
   */
  private async balanceAsOf(accountId: string, instant: Date): Promise<string> {
    const priorTx = await this.txRepo
      .createQueryBuilder('tx')
      .where('tx.corporateAccountId = :accountId', { accountId })
      .andWhere('tx.createdAt < :instant', { instant })
      .orderBy('tx.createdAt', 'DESC')
      .getOne();
    return priorTx?.balanceAfter ?? '0.00';
  }

  /**
   * Generates (or returns the already-generated) statement for one
   * exact period on one account. Idempotent by design - both the
   * monthly cron below and a manual admin re-trigger can call this
   * freely for the same account+period without ever producing a
   * second row for the same month, since corporate_invoices has a
   * real unique index on (corporateAccountId, periodStart, periodEnd)
   * backing this, not just an application-level check that a race
   * could slip past.
   */
  async generateInvoiceForPeriod(accountId: string, periodStart: Date, periodEnd: Date): Promise<CorporateInvoice> {
    const existing = await this.invoicesRepo.findOne({ where: { corporateAccountId: accountId, periodStart, periodEnd } });
    if (existing) return existing;

    const account = await this.accountsRepo.findOne({ where: { id: accountId } });
    if (!account) throw new NotFoundException('Corporate account not found');

    const [openingBalance, closingBalance, totals] = await Promise.all([
      this.balanceAsOf(accountId, periodStart),
      this.balanceAsOf(accountId, periodEnd),
      this.txRepo
        .createQueryBuilder('tx')
        .select('tx.direction', 'direction')
        .addSelect('COUNT(*)', 'count')
        .addSelect('COALESCE(SUM(tx.amount), 0)', 'total')
        .where('tx.corporateAccountId = :accountId', { accountId })
        .andWhere('tx.createdAt >= :periodStart AND tx.createdAt < :periodEnd', { periodStart, periodEnd })
        .groupBy('tx.direction')
        .getRawMany(),
    ]);

    const debitRow = totals.find((t) => t.direction === TransactionDirection.DEBIT);
    const creditRow = totals.find((t) => t.direction === TransactionDirection.CREDIT);
    const transactionCount = totals.reduce((sum, t) => sum + parseInt(t.count, 10), 0);

    try {
      return await this.invoicesRepo.save(
        this.invoicesRepo.create({
          corporateAccountId: accountId,
          periodStart,
          periodEnd,
          openingBalance,
          closingBalance,
          totalDebits: debitRow?.total ?? '0.00',
          totalCredits: creditRow?.total ?? '0.00',
          transactionCount,
          currency: account.currency,
        }),
      );
    } catch {
      // Lost a race with another concurrent generation attempt for
      // this exact period (the unique index rejected the insert) -
      // the other one already produced the correct statement, so
      // return that instead of surfacing a confusing failure for
      // what is, from the caller's point of view, a successful
      // "make sure this period's invoice exists" request.
      const winner = await this.invoicesRepo.findOne({ where: { corporateAccountId: accountId, periodStart, periodEnd } });
      if (winner) return winner;
      throw new ConflictException('Could not generate invoice for this period');
    }
  }

  /**
   * Runs at the start of every month and closes out the previous
   * calendar month for every currently-active account - including
   * one that had zero activity all month (still a valid, real
   * statement: "nothing moved, balance stayed at X"). An account that
   * was deactivated mid-month still gets its final month's statement
   * generated on the next run, since isActive only gates which
   * accounts this cron considers going forward, not which past
   * periods are eligible.
   */
  @Cron(CronExpression.EVERY_1ST_DAY_OF_MONTH_AT_MIDNIGHT)
  async generateMonthlyInvoices(): Promise<void> {
    const now = new Date();
    // The month that just ended, in UTC calendar terms - e.g. running
    // on Feb 1st closes out January 1st (00:00) through February 1st
    // (00:00), exclusive.
    const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));

    const accounts = await this.accountsRepo.find({ where: { isActive: true } });
    for (const account of accounts) {
      await this.generateInvoiceForPeriod(account.id, periodStart, periodEnd);
    }
  }

  /** Every past statement for this account, most recent first - the account owner's own "Statements" list. */
  async listInvoices(accountId: string): Promise<CorporateInvoice[]> {
    return this.invoicesRepo.find({ where: { corporateAccountId: accountId }, order: { periodStart: 'DESC' } });
  }

  /**
   * One statement's full detail: the stored summary plus the actual
   * itemized transactions for that exact period, queried live from
   * CorporateTransaction rather than duplicated onto the invoice row
   * itself - see CorporateInvoice's own class comment for why.
   */
  async getInvoiceDetail(
    accountId: string,
    invoiceId: string,
  ): Promise<{ invoice: CorporateInvoice; lineItems: CorporateTransaction[] }> {
    const invoice = await this.invoicesRepo.findOne({ where: { id: invoiceId, corporateAccountId: accountId } });
    if (!invoice) throw new NotFoundException('Invoice not found');

    const lineItems = await this.txRepo.find({
      where: { corporateAccountId: accountId },
      order: { createdAt: 'ASC' },
    });
    const filtered = lineItems.filter((tx) => tx.createdAt >= invoice.periodStart && tx.createdAt < invoice.periodEnd);

    return { invoice, lineItems: filtered };
  }

  /**
   * Called once, right after a corporate ride's debit succeeds - if
   * the fare crossed the account's soft threshold, this ride goes on
   * the owner's after-the-fact review list. Silent no-op when no
   * threshold is configured or the fare didn't cross it - most
   * corporate rides never touch this table at all.
   */
  async flagRideForApprovalIfNeeded(
    account: CorporateAccount,
    rideId: string,
    employeeUserId: string,
    fareAmount: number,
  ): Promise<void> {
    if (account.requiresApprovalAboveFare == null) return;
    if (fareAmount <= parseFloat(account.requiresApprovalAboveFare)) return;

    await this.approvalsRepo.save(
      this.approvalsRepo.create({
        corporateAccountId: account.id,
        rideId,
        employeeUserId,
        fareAmount: fareAmount.toFixed(2),
      }),
    );

    this.events.emit('corporate.ride_flagged_for_approval', { ownerId: account.ownerUserId, rideId, fareAmount });
  }

  async listApprovals(accountId: string, status?: CorporateApprovalStatus): Promise<CorporateRideApproval[]> {
    return this.approvalsRepo.find({
      where: status ? { corporateAccountId: accountId, status } : { corporateAccountId: accountId },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Records the owner's decision - never reverses the ride or its
   * charge (see the entity's own doc comment for why this is
   * deliberately after-the-fact, not a real-time gate). A REJECTED
   * ride stays exactly as billed; rejection is the company's own
   * record that this particular trip didn't meet policy, for
   * whatever internal process (a conversation with the employee, a
   * reimbursement adjustment) that implies on their end.
   */
  async reviewApproval(
    accountId: string,
    approvalId: string,
    reviewerId: string,
    status: CorporateApprovalStatus,
    notes?: string,
  ): Promise<CorporateRideApproval> {
    const approval = await this.approvalsRepo.findOne({ where: { id: approvalId, corporateAccountId: accountId } });
    if (!approval) throw new NotFoundException('Approval record not found');
    if (approval.status !== CorporateApprovalStatus.PENDING) {
      throw new BadRequestException('This ride has already been reviewed');
    }

    approval.status = status;
    approval.reviewedBy = reviewerId;
    approval.reviewNotes = notes ?? null;
    approval.reviewedAt = new Date();
    return this.approvalsRepo.save(approval);
  }

  async getAccountForEmployee(userId: string): Promise<CorporateAccount | null> {
    const employee = await this.employeesRepo.findOne({
      where: { userId, isActive: true },
    });
    if (!employee) return null;
    return this.findById(employee.corporateAccountId);
  }

  async listTransactions(accountId: string, limit = 50): Promise<CorporateTransaction[]> {
    return this.txRepo.find({
      where: { corporateAccountId: accountId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  async topUp(accountId: string, amount: number, description?: string): Promise<CorporateAccount> {
    return this.applyLedgerChange(accountId, amount, TransactionDirection.CREDIT, undefined, description);
  }

  /**
   * Debits the corporate travel budget for a ride paid via PaymentMethod.CORPORATE.
   * Runs inside a DB transaction with a row lock, same pattern as WalletsService.
   */
  async debitForRide(
    accountId: string,
    amount: number,
    rideId: string,
    employeeUserId: string,
  ): Promise<CorporateAccount> {
    const employee = await this.employeesRepo.findOne({ where: { userId: employeeUserId } });
    return this.applyLedgerChange(
      accountId,
      amount,
      TransactionDirection.DEBIT,
      rideId,
      `Ride payment for trip ${rideId}`,
      employeeUserId,
      employee?.department ?? null,
    );
  }

  private async applyLedgerChange(
    accountId: string,
    amount: number,
    direction: TransactionDirection,
    referenceId?: string,
    description?: string,
    employeeUserId?: string | null,
    department?: string | null,
  ): Promise<CorporateAccount> {
    if (amount <= 0) throw new BadRequestException('Amount must be positive');

    return this.accountsRepo.manager.transaction(async (manager) => {
      const account = await manager.findOne(CorporateAccount, {
        where: { id: accountId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!account) throw new NotFoundException('Corporate account not found');
      if (!account.isActive) throw new BadRequestException('Corporate account is inactive');

      const currentBalance = parseFloat(account.budgetBalance);
      if (direction === TransactionDirection.DEBIT && currentBalance < amount) {
        throw new BadRequestException('Insufficient corporate budget');
      }

      const newBalance =
        direction === TransactionDirection.CREDIT
          ? currentBalance + amount
          : currentBalance - amount;
      account.budgetBalance = newBalance.toFixed(2);
      await manager.save(account);

      await manager.save(CorporateTransaction, {
        corporateAccountId: accountId,
        direction,
        amount: amount.toFixed(2),
        balanceAfter: account.budgetBalance,
        referenceId,
        description,
        employeeUserId: employeeUserId ?? null,
        department: department ?? null,
      });

      return account;
    });
  }

  /**
   * Corporate had zero admin-facing endpoints at all before this — only
   * self-service ones (accounts/mine/*). Same enrichment pattern as
   * Fleet: owner name, employee count, reused UsersService.findByIds()
   * rather than a raw join, since it already existed from an earlier
   * round (built for the driver Referral Centre).
   */
  async listForAdmin() {
    const accounts = await this.accountsRepo.find({ order: { createdAt: 'DESC' } });
    if (accounts.length === 0) return [];

    const ownerIds = accounts.map((a) => a.ownerUserId);
    const owners = await this.usersService.findByIds(ownerIds);
    const ownerById = new Map(owners.map((o) => [o.id, o]));

    const employeeCounts = await this.employeesRepo
      .createQueryBuilder('e')
      .select('e.corporateAccountId', 'corporateAccountId')
      .addSelect('COUNT(*)', 'count')
      .where('e.corporateAccountId IN (:...ids)', { ids: accounts.map((a) => a.id) })
      .groupBy('e.corporateAccountId')
      .getRawMany();
    const employeeCountByAccount = new Map(employeeCounts.map((r) => [r.corporateAccountId, parseInt(r.count, 10)]));

    return accounts.map((a) => {
      const owner = ownerById.get(a.ownerUserId);
      return {
        id: a.id,
        companyName: a.companyName,
        budgetBalance: a.budgetBalance,
        currency: a.currency,
        isActive: a.isActive,
        createdAt: a.createdAt,
        ownerFirstName: owner?.firstName ?? null,
        ownerLastName: owner?.lastName ?? null,
        ownerPhone: owner?.phone ?? null,
        employeeCount: employeeCountByAccount.get(a.id) ?? 0,
      };
    });
  }

  async setActive(id: string, isActive: boolean): Promise<CorporateAccount> {
    const account = await this.accountsRepo.findOne({ where: { id } });
    if (!account) throw new NotFoundException('Corporate account not found');
    account.isActive = isActive;
    return this.accountsRepo.save(account);
  }
}
