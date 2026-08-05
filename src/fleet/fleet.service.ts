import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { FleetCompany } from './entities/fleet-company.entity';
import { FleetStaff, FleetStaffRole } from './entities/fleet-staff.entity';
import { FleetWallet } from './entities/fleet-wallet.entity';
import { FleetTransaction, FleetTransactionCategory } from './entities/fleet-transaction.entity';
import { FleetPayout, FleetPayoutStatus } from './entities/fleet-payout.entity';
import { TransactionDirection } from '../common/enums/transaction.enum';
import { DriversService } from '../drivers/drivers.service';
import { VehiclesService } from '../vehicles/vehicles.service';
import { PaystackService } from '../payments/paystack/paystack.service';
import {
  CreateFleetCompanyDto,
} from './dto/fleet.dto';

export interface FleetAnalytics {
  totalDrivers: number;
  totalVehicles: number;
  walletBalance: string;
  totalRideEarnings: string;
  totalPaidOut: string;
}

@Injectable()
export class FleetService {
  constructor(
    @InjectRepository(FleetCompany)
    private readonly companiesRepo: Repository<FleetCompany>,
    @InjectRepository(FleetStaff)
    private readonly staffRepo: Repository<FleetStaff>,
    @InjectRepository(FleetWallet)
    private readonly walletsRepo: Repository<FleetWallet>,
    @InjectRepository(FleetTransaction)
    private readonly txRepo: Repository<FleetTransaction>,
    @InjectRepository(FleetPayout)
    private readonly payoutsRepo: Repository<FleetPayout>,
    private readonly driversService: DriversService,
    private readonly vehiclesService: VehiclesService,
    private readonly paystack: PaystackService,
  ) {}

  // ---- Companies & staff ----

  async createCompany(ownerUserId: string, dto: CreateFleetCompanyDto): Promise<FleetCompany> {
    const existingStaff = await this.staffRepo.findOne({ where: { userId: ownerUserId } });
    if (existingStaff) {
      throw new ConflictException('You already belong to a fleet company');
    }

    const company = await this.companiesRepo.save(this.companiesRepo.create({ ownerUserId, ...dto }));
    await this.walletsRepo.save(this.walletsRepo.create({ fleetCompanyId: company.id, balance: '0' }));
    await this.staffRepo.save(
      this.staffRepo.create({ fleetCompanyId: company.id, userId: ownerUserId, role: FleetStaffRole.OWNER }),
    );

    return company;
  }

  async findById(id: string): Promise<FleetCompany> {
    const company = await this.companiesRepo.findOne({ where: { id } });
    if (!company) throw new NotFoundException('Fleet company not found');
    return company;
  }

  /**
   * Same "raw list, no name" gap found repeatedly elsewhere in this
   * codebase — plus driver/vehicle counts and wallet balance, since
   * admin can't meaningfully manage a fleet company without knowing
   * its actual size. ownerUserId is a plain @Column() with no relation
   * annotation, so it needs the ::text cast like most cases (not the
   * @JoinColumn exception that DriverProfile.userId turned out to be).
   */
  async listForAdmin() {
    const companies = await this.companiesRepo.find({ order: { createdAt: 'DESC' } });
    if (companies.length === 0) return [];

    const ids = companies.map((c) => c.id);
    const ownerIds = companies.map((c) => c.ownerUserId);

    const [owners, driverCounts, vehicleCounts, wallets]: [
      { id: string; firstName: string; lastName: string; phone: string }[],
      any[],
      any[],
      FleetWallet[],
    ] = await Promise.all([
      this.companiesRepo.manager.query(
        `SELECT id, "firstName", "lastName", phone FROM users WHERE id::text = ANY($1)`,
        [ownerIds],
      ),
      this.companiesRepo.manager.query(
        `SELECT "fleetCompanyId", COUNT(*)::int as count FROM driver_profiles WHERE "fleetCompanyId" = ANY($1) GROUP BY "fleetCompanyId"`,
        [ids],
      ),
      this.companiesRepo.manager.query(
        `SELECT "fleetCompanyId", COUNT(*)::int as count FROM vehicles WHERE "fleetCompanyId" = ANY($1) GROUP BY "fleetCompanyId"`,
        [ids],
      ),
      this.walletsRepo.find({ where: { fleetCompanyId: In(ids) } }),
    ]);

    const ownerById = new Map(owners.map((o: any) => [o.id, o]));
    const driverCountByCompany = new Map(driverCounts.map((r: any) => [r.fleetCompanyId, r.count]));
    const vehicleCountByCompany = new Map(vehicleCounts.map((r: any) => [r.fleetCompanyId, r.count]));
    const walletByCompany = new Map(wallets.map((w) => [w.fleetCompanyId, w]));

    return companies.map((c) => {
      const owner = ownerById.get(c.ownerUserId);
      return {
        id: c.id,
        name: c.name,
        registrationNumber: c.registrationNumber,
        city: c.city,
        isActive: c.isActive,
        createdAt: c.createdAt,
        ownerFirstName: owner?.firstName ?? null,
        ownerLastName: owner?.lastName ?? null,
        ownerPhone: owner?.phone ?? null,
        driverCount: driverCountByCompany.get(c.id) ?? 0,
        vehicleCount: vehicleCountByCompany.get(c.id) ?? 0,
        walletBalance: walletByCompany.get(c.id)?.balance ?? '0.00',
      };
    });
  }

  async setActive(id: string, isActive: boolean): Promise<FleetCompany> {
    const company = await this.companiesRepo.findOne({ where: { id } });
    if (!company) throw new NotFoundException('Fleet company not found');
    company.isActive = isActive;
    return this.companiesRepo.save(company);
  }

  /** Resolves the fleet company a staff member (owner or manager) belongs to. */
  async getCompanyForStaff(userId: string): Promise<FleetCompany> {
    const staff = await this.staffRepo.findOne({ where: { userId } });
    if (!staff) throw new NotFoundException('You do not belong to a fleet company');
    return this.findById(staff.fleetCompanyId);
  }

  async addManager(fleetCompanyId: string, actorUserId: string, managerUserId: string): Promise<FleetStaff> {
    await this.assertIsOwner(fleetCompanyId, actorUserId);

    const existing = await this.staffRepo.findOne({ where: { userId: managerUserId } });
    if (existing) throw new ConflictException('That user already belongs to a fleet company');

    return this.staffRepo.save(
      this.staffRepo.create({ fleetCompanyId, userId: managerUserId, role: FleetStaffRole.MANAGER }),
    );
  }

  private async assertIsStaff(fleetCompanyId: string, userId: string): Promise<FleetStaff> {
    const staff = await this.staffRepo.findOne({ where: { fleetCompanyId, userId } });
    if (!staff) throw new ForbiddenException('You are not staff of this fleet company');
    return staff;
  }

  private async assertIsOwner(fleetCompanyId: string, userId: string): Promise<void> {
    const staff = await this.assertIsStaff(fleetCompanyId, userId);
    if (staff.role !== FleetStaffRole.OWNER) {
      throw new ForbiddenException('Only the fleet owner can do this');
    }
  }

  // ---- Driver / vehicle assignment ----

  async assignDriver(fleetCompanyId: string, actorUserId: string, driverUserId: string): Promise<void> {
    await this.assertIsStaff(fleetCompanyId, actorUserId);
    const profile = await this.driversService.findByUserId(driverUserId);
    if (profile.fleetCompanyId && profile.fleetCompanyId !== fleetCompanyId) {
      throw new ConflictException('Driver already belongs to another fleet company');
    }
    await this.driversService.assignToFleet(driverUserId, fleetCompanyId);
  }

  async removeDriver(fleetCompanyId: string, actorUserId: string, driverUserId: string): Promise<void> {
    await this.assertIsStaff(fleetCompanyId, actorUserId);
    const profile = await this.driversService.findByUserId(driverUserId);
    if (profile.fleetCompanyId !== fleetCompanyId) {
      throw new BadRequestException('This driver does not belong to your fleet');
    }
    await this.driversService.assignToFleet(driverUserId, null);
  }

  async listDrivers(fleetCompanyId: string) {
    return this.driversService.listByFleet(fleetCompanyId);
  }

  async assignVehicle(fleetCompanyId: string, actorUserId: string, vehicleId: string): Promise<void> {
    await this.assertIsStaff(fleetCompanyId, actorUserId);
    await this.vehiclesService.assignToFleet(vehicleId, fleetCompanyId);
  }

  async listVehicles(fleetCompanyId: string) {
    return this.vehiclesService.listByFleet(fleetCompanyId);
  }

  // ---- Wallet ----

  async getWallet(fleetCompanyId: string): Promise<FleetWallet> {
    const wallet = await this.walletsRepo.findOne({ where: { fleetCompanyId } });
    if (!wallet) throw new NotFoundException('Fleet wallet not found');
    return wallet;
  }

  async listTransactions(fleetCompanyId: string, limit = 50): Promise<FleetTransaction[]> {
    const wallet = await this.getWallet(fleetCompanyId);
    return this.txRepo.find({
      where: { fleetWalletId: wallet.id },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  /** Credits a fleet's wallet — called by RidesService when a fleet driver completes a ride. */
  async creditForRideEarning(fleetCompanyId: string, amount: number, rideId: string): Promise<void> {
    const wallet = await this.getWallet(fleetCompanyId);
    await this.applyLedgerChange(
      wallet.id,
      amount,
      TransactionDirection.CREDIT,
      FleetTransactionCategory.RIDE_EARNING,
      rideId,
      `Ride earnings from trip ${rideId}`,
    );
  }

  /** Debits commission owed on a cash trip completed by a fleet driver. */
  async debitFleetCommission(fleetCompanyId: string, amount: number, rideId: string): Promise<void> {
    const wallet = await this.getWallet(fleetCompanyId);
    await this.applyLedgerChange(
      wallet.id,
      amount,
      TransactionDirection.DEBIT,
      FleetTransactionCategory.ADJUSTMENT,
      rideId,
      `Commission owed on cash trip ${rideId}`,
    );
  }

  private async applyLedgerChange(
    walletId: string,
    amount: number,
    direction: TransactionDirection,
    category: FleetTransactionCategory,
    referenceId?: string,
    description?: string,
  ): Promise<FleetWallet> {
    if (amount <= 0) throw new BadRequestException('Amount must be positive');

    return this.walletsRepo.manager.transaction(async (manager) => {
      const wallet = await manager.findOne(FleetWallet, {
        where: { id: walletId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!wallet) throw new NotFoundException('Fleet wallet not found');

      const currentBalance = parseFloat(wallet.balance);
      if (direction === TransactionDirection.DEBIT && currentBalance < amount) {
        throw new BadRequestException('Insufficient fleet wallet balance');
      }

      const newBalance = direction === TransactionDirection.CREDIT ? currentBalance + amount : currentBalance - amount;
      wallet.balance = newBalance.toFixed(2);
      await manager.save(wallet);

      await manager.save(FleetTransaction, {
        fleetWalletId: wallet.id,
        direction,
        category,
        amount: amount.toFixed(2),
        balanceAfter: wallet.balance,
        referenceId,
        description,
      });

      return wallet;
    });
  }

  // ---- Payouts ----

  async requestPayout(
    fleetCompanyId: string,
    actorUserId: string,
    amount: number,
    bankAccountNumber: string,
    bankCode: string,
  ): Promise<FleetPayout> {
    await this.assertIsOwner(fleetCompanyId, actorUserId);

    const wallet = await this.getWallet(fleetCompanyId);
    if (parseFloat(wallet.balance) < amount) {
      throw new BadRequestException('Insufficient fleet wallet balance for this payout');
    }

    // Debit first — if the transfer subsequently fails, an admin reconciles
    // manually (same pattern real payout systems use: hold the funds out of
    // the spendable balance while the transfer is in flight).
    await this.applyLedgerChange(
      wallet.id,
      amount,
      TransactionDirection.DEBIT,
      FleetTransactionCategory.PAYOUT,
      undefined,
      'Fleet payout requested',
    );

    const payout = await this.payoutsRepo.save(
      this.payoutsRepo.create({
        fleetCompanyId,
        amount: amount.toFixed(2),
        bankAccountNumber,
        bankCode,
        status: FleetPayoutStatus.PENDING,
      }),
    );

    if (!this.paystack.isConfigured()) {
      payout.status = FleetPayoutStatus.SUCCESS;
      payout.simulated = true;
      return this.payoutsRepo.save(payout);
    }

    try {
      const company = await this.findById(fleetCompanyId);
      const recipient = await this.paystack.createTransferRecipient({
        name: company.name,
        accountNumber: bankAccountNumber,
        bankCode,
      });
      const transfer = await this.paystack.initiateTransfer({
        amountKobo: Math.round(amount * 100),
        recipientCode: recipient.recipientCode,
        reason: `Fleet payout — ${company.name}`,
        reference: `fleet-payout-${payout.id}`,
      });

      payout.status = FleetPayoutStatus.PROCESSING;
      payout.paystackTransferCode = transfer.transferCode;
    } catch (err) {
      payout.status = FleetPayoutStatus.FAILED;
      payout.failureReason = (err as Error).message;
      // Refund the wallet since the transfer never went out.
      await this.applyLedgerChange(
        wallet.id,
        amount,
        TransactionDirection.CREDIT,
        FleetTransactionCategory.ADJUSTMENT,
        payout.id,
        'Refund — payout transfer failed',
      );
    }

    return this.payoutsRepo.save(payout);
  }

  async listPayouts(fleetCompanyId: string): Promise<FleetPayout[]> {
    return this.payoutsRepo.find({ where: { fleetCompanyId }, order: { createdAt: 'DESC' } });
  }

  // ---- Analytics ----

  async getAnalytics(fleetCompanyId: string): Promise<FleetAnalytics> {
    const [drivers, vehicles, wallet, transactions, payouts] = await Promise.all([
      this.driversService.listByFleet(fleetCompanyId),
      this.vehiclesService.listByFleet(fleetCompanyId),
      this.getWallet(fleetCompanyId),
      this.listTransactions(fleetCompanyId, 10000),
      this.listPayouts(fleetCompanyId),
    ]);

    const totalRideEarnings = transactions
      .filter((t) => t.category === FleetTransactionCategory.RIDE_EARNING)
      .reduce((sum, t) => sum + parseFloat(t.amount), 0);

    const totalPaidOut = payouts
      .filter((p) => p.status === FleetPayoutStatus.SUCCESS || p.status === FleetPayoutStatus.PROCESSING)
      .reduce((sum, p) => sum + parseFloat(p.amount), 0);

    return {
      totalDrivers: drivers.length,
      totalVehicles: vehicles.length,
      walletBalance: wallet.balance,
      totalRideEarnings: totalRideEarnings.toFixed(2),
      totalPaidOut: totalPaidOut.toFixed(2),
    };
  }
}
