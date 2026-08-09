import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SystemSetting } from './entities/system-setting.entity';
import { UpsertSettingDto } from './dto/settings.dto';

/** Well-known setting keys referenced elsewhere in the codebase. */
export const SETTING_KEYS = {
  CANCELLATION_FEE: 'pricing.cancellationFee',
  REFEREE_BONUS: 'referral.refereeBonus',
  REFERRER_BONUS: 'referral.referrerBonus',
  WALLET_MAX_BALANCE: 'wallet.maxBalance',
  MAINTENANCE_MODE: 'system.maintenanceMode',
  MAX_CASH_DEBT_BEFORE_RESTRICTION: 'wallet.maxCashDebtBeforeRestriction',
} as const;

interface CacheEntry {
  value: string;
  expiresAt: number;
}

const CACHE_TTL_MS = 30_000;

@Injectable()
export class SystemSettingsService {
  private cache = new Map<string, CacheEntry>();

  /** Exposed for operational tooling — forces the next read of every key to hit the DB. */
  clearCache(): number {
    const size = this.cache.size;
    this.cache.clear();
    return size;
  }

  constructor(
    @InjectRepository(SystemSetting)
    private readonly repo: Repository<SystemSetting>,
  ) {}

  async getRaw(key: string): Promise<string | null> {
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const setting = await this.repo.findOne({ where: { key } });
    if (!setting) {
      this.cache.delete(key);
      return null;
    }

    this.cache.set(key, { value: setting.value, expiresAt: Date.now() + CACHE_TTL_MS });
    return setting.value;
  }

  /** Returns the DB-configured value if set, otherwise the caller's fallback (typically an env-config default). */
  async getNumber(key: string, fallback: number): Promise<number> {
    const raw = await this.getRaw(key);
    if (raw === null) return fallback;
    const parsed = parseFloat(raw);
    return Number.isNaN(parsed) ? fallback : parsed;
  }

  async getBoolean(key: string, fallback: boolean): Promise<boolean> {
    const raw = await this.getRaw(key);
    if (raw === null) return fallback;
    return raw === 'true';
  }

  async getString(key: string, fallback: string): Promise<string> {
    const raw = await this.getRaw(key);
    return raw ?? fallback;
  }

  async listAll(): Promise<SystemSetting[]> {
    return this.repo.find({ order: { key: 'ASC' } });
  }

  async set(key: string, updatedBy: string, dto: UpsertSettingDto): Promise<SystemSetting> {
    let setting = await this.repo.findOne({ where: { key } });
    if (!setting) {
      setting = this.repo.create({ key });
    }
    setting.value = dto.value;
    if (dto.description !== undefined) setting.description = dto.description;
    setting.updatedBy = updatedBy;
    const saved = await this.repo.save(setting);

    this.cache.delete(key); // don't serve a stale value after an explicit write
    return saved;
  }

  async delete(key: string): Promise<void> {
    await this.repo.delete({ key });
    this.cache.delete(key);
  }
}
