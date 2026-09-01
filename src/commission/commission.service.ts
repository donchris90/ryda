import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CommissionRule } from './entities/commission-rule.entity';
import { DriverLevel, DEFAULT_COMMISSION_BY_LEVEL } from '../common/enums/driver-level.enum';
import { VehicleCategory } from '../common/enums/vehicle.enum';
import { Ride } from '../rides/entities/ride.entity';
import { RideStatus } from '../common/enums/ride.enum';
import { User } from '../users/entities/user.entity';
import { SystemSettingsService, SETTING_KEYS } from '../settings/settings.service';

interface ResolveInput {
  driverLevel: DriverLevel;
  vehicleCategory?: VehicleCategory;
  city?: string;
}

// Maps each level to its setting key, so the admin-configurable value
// can be looked up without a big switch statement at every call site.
const COMMISSION_SETTING_KEY_BY_LEVEL: Record<DriverLevel, string> = {
  [DriverLevel.ROOKIE]: SETTING_KEYS.COMMISSION_DEFAULT_ROOKIE,
  [DriverLevel.STANDARD]: SETTING_KEYS.COMMISSION_DEFAULT_STANDARD,
  [DriverLevel.SILVER]: SETTING_KEYS.COMMISSION_DEFAULT_SILVER,
  [DriverLevel.GOLD]: SETTING_KEYS.COMMISSION_DEFAULT_GOLD,
  [DriverLevel.PLATINUM]: SETTING_KEYS.COMMISSION_DEFAULT_PLATINUM,
  [DriverLevel.DIAMOND]: SETTING_KEYS.COMMISSION_DEFAULT_DIAMOND,
  [DriverLevel.ELITE]: SETTING_KEYS.COMMISSION_DEFAULT_ELITE,
};

@Injectable()
export class CommissionService {
  constructor(
    @InjectRepository(CommissionRule)
    private readonly rulesRepo: Repository<CommissionRule>,
    @InjectRepository(Ride)
    private readonly ridesRepo: Repository<Ride>,
    private readonly settingsService: SystemSettingsService,
  ) {}

  /**
   * Picks the most specific active rule matching (city + vehicleCategory + driverLevel),
   * falling back to progressively less specific rules, and finally to the
   * platform default commission for the driver's level - which used to
   * be a hardcoded constant with no admin-editable path at all. Now
   * reads from settings, with the original hardcoded value as the
   * fallback if nothing's been configured yet, so nothing changes for
   * an admin who's never touched this.
   */
  async resolveCommissionPercent(input: ResolveInput): Promise<number> {
    // Ordered explicitly (unlike listRules(), which orders for display
    // purposes only) so that ties in specificity below resolve
    // deterministically to the most-recently-created rule rather than
    // whatever order Postgres happens to return rows in. This matters
    // in practice: with no edit UI for rules until now, admins worked
    // around it by creating a second rule for the same
    // level/vehicle/city combo instead of editing the first, which
    // would otherwise make the winning rule undefined.
    const candidates = await this.rulesRepo.find({ where: { isActive: true }, order: { createdAt: 'DESC' } });

    const scored = candidates
      .filter((rule) => this.matches(rule, input))
      .map((rule) => ({ rule, score: this.specificity(rule) }))
      .sort((a, b) => b.score - a.score);

    if (scored.length > 0) {
      return parseFloat(scored[0].rule.commissionPercent);
    }

    return this.settingsService.getNumber(
      COMMISSION_SETTING_KEY_BY_LEVEL[input.driverLevel],
      DEFAULT_COMMISSION_BY_LEVEL[input.driverLevel],
    );
  }

  /** Admin-facing: the currently configured (or default) commission for every level, for display/editing. */
  async getDefaultsByLevel(): Promise<Record<DriverLevel, number>> {
    const entries = await Promise.all(
      Object.values(DriverLevel).map(async (level) => [
        level,
        await this.settingsService.getNumber(COMMISSION_SETTING_KEY_BY_LEVEL[level], DEFAULT_COMMISSION_BY_LEVEL[level]),
      ]),
    );
    return Object.fromEntries(entries);
  }

  /** Admin-facing: set the platform default commission for one driver level. */
  async setDefaultForLevel(level: DriverLevel, percent: number, updatedBy: string): Promise<void> {
    await this.settingsService.set(COMMISSION_SETTING_KEY_BY_LEVEL[level], updatedBy, { value: percent.toString() });
  }

  private matches(rule: CommissionRule, input: ResolveInput): boolean {
    if (rule.driverLevel && rule.driverLevel !== input.driverLevel) return false;
    if (rule.vehicleCategory && rule.vehicleCategory !== input.vehicleCategory) return false;
    if (rule.city && input.city && rule.city.toLowerCase() !== input.city.toLowerCase()) return false;
    if (rule.city && !input.city) return false;
    return true;
  }

  private specificity(rule: CommissionRule): number {
    let score = 0;
    if (rule.driverLevel) score += 1;
    if (rule.vehicleCategory) score += 1;
    if (rule.city) score += 1;
    return score;
  }

  async listRules(): Promise<CommissionRule[]> {
    return this.rulesRepo.find({ order: { createdAt: 'DESC' } });
  }

  async createRule(data: Partial<CommissionRule>): Promise<CommissionRule> {
    const rule = this.rulesRepo.create(data);
    return this.rulesRepo.save(rule);
  }

  async updateRule(id: string, data: Partial<CommissionRule>): Promise<CommissionRule> {
    const rule = await this.rulesRepo.findOne({ where: { id } });
    if (!rule) throw new NotFoundException('Commission rule not found');
    Object.assign(rule, data);
    return this.rulesRepo.save(rule);
  }

  async deleteRule(id: string): Promise<void> {
    const result = await this.rulesRepo.delete(id);
    if (result.affected === 0) throw new NotFoundException('Commission rule not found');
  }

  /**
   * The Overview dashboard already shows total commission collected
   * (as "platform revenue") and its trend over time — this doesn't
   * duplicate that. What was genuinely missing for "commission
   * reports": a per-driver breakdown, so staff can see who's actually
   * generating the most commission, not just the platform-wide total.
   * Ride.commissionAmount/driverEarnings are already computed and
   * stored per ride at completion time, so this is a straightforward
   * aggregation, not new commission-calculation logic.
   */
  async getByDriver(from?: Date, to?: Date, limit = 25) {
    const qb = this.ridesRepo
      .createQueryBuilder('ride')
      .leftJoin(User, 'driver', 'driver.id::text = ride.driverId')
      .select('ride.driverId', 'driverId')
      .addSelect('driver.firstName', 'driverFirstName')
      .addSelect('driver.lastName', 'driverLastName')
      .addSelect('COUNT(*)', 'completedRides')
      .addSelect('COALESCE(SUM(ride.totalFare), 0)', 'totalFares')
      .addSelect('COALESCE(SUM(ride.commissionAmount), 0)', 'totalCommission')
      .addSelect('COALESCE(SUM(ride.driverEarnings), 0)', 'totalDriverEarnings')
      .where('ride.status = :status', { status: RideStatus.COMPLETED })
      .andWhere('ride.driverId IS NOT NULL');

    if (from) qb.andWhere('ride.completedAt >= :from', { from });
    if (to) qb.andWhere('ride.completedAt <= :to', { to });

    const rows = await qb
      .groupBy('ride.driverId')
      .addGroupBy('driver.firstName')
      .addGroupBy('driver.lastName')
      .orderBy('"totalCommission"', 'DESC')
      .limit(limit)
      .getRawMany();

    return rows.map((r) => ({
      driverId: r.driverId,
      driverFirstName: r.driverFirstName,
      driverLastName: r.driverLastName,
      completedRides: parseInt(r.completedRides, 10),
      totalFares: parseFloat(r.totalFares).toFixed(2),
      totalCommission: parseFloat(r.totalCommission).toFixed(2),
      totalDriverEarnings: parseFloat(r.totalDriverEarnings).toFixed(2),
    }));
  }

  async getSummary(from?: Date, to?: Date) {
    const qb = this.ridesRepo
      .createQueryBuilder('ride')
      .select('COUNT(*)', 'completedRides')
      .addSelect('COALESCE(SUM(ride.totalFare), 0)', 'totalFares')
      .addSelect('COALESCE(SUM(ride.commissionAmount), 0)', 'totalCommission')
      .addSelect('COALESCE(SUM(ride.driverEarnings), 0)', 'totalDriverEarnings')
      .where('ride.status = :status', { status: RideStatus.COMPLETED });

    if (from) qb.andWhere('ride.completedAt >= :from', { from });
    if (to) qb.andWhere('ride.completedAt <= :to', { to });

    const row = await qb.getRawOne();
    return {
      completedRides: parseInt(row.completedRides, 10),
      totalFares: parseFloat(row.totalFares).toFixed(2),
      totalCommission: parseFloat(row.totalCommission).toFixed(2),
      totalDriverEarnings: parseFloat(row.totalDriverEarnings).toFixed(2),
    };
  }
}
