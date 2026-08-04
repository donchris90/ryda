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
import { TransactionDirection } from '../common/enums/transaction.enum';
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
  ): Promise<CorporateAccount> {
    return this.applyLedgerChange(
      accountId,
      amount,
      TransactionDirection.DEBIT,
      rideId,
      `Ride payment for trip ${rideId}`,
    );
  }

  private async applyLedgerChange(
    accountId: string,
    amount: number,
    direction: TransactionDirection,
    referenceId?: string,
    description?: string,
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
      });

      return account;
    });
  }
}
