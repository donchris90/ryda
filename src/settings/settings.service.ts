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
  PRICING_PER_KM: 'pricing.perKm',
  PRICING_MINIMUM_FARE: 'pricing.minimumFare',
  PRICING_AIRPORT_FEE: 'pricing.airportFee',
  PRICING_NIGHT_MULTIPLIER: 'pricing.nightMultiplier',
  // Tiered time-based fare: a flat price covers the first block of minutes,
  // then a flat increment is added per additional block (whole or partial).
  // Replaces the old flat baseFare + linear perMinute combination.
  PRICING_TIER_MINUTES: 'pricing.tierMinutes',
  PRICING_TIER_BASE_FARE: 'pricing.tierBaseFare',
  PRICING_TIER_INCREMENT_FARE: 'pricing.tierIncrementFare',
  LOGISTICS_BASE_FARE: 'logistics.baseFare',
  LOGISTICS_PER_KM: 'logistics.perKm',
  LOGISTICS_PER_KG: 'logistics.perKg',
  LOGISTICS_MINIMUM_FARE: 'logistics.minimumFare',
  WALLET_TRANSFER_MIN: 'wallet.transferMin',
  WALLET_TRANSFER_MAX_PER_TRANSACTION: 'wallet.transferMaxPerTransaction',
  WALLET_TRANSFER_MAX_DAILY: 'wallet.transferMaxDaily',
  WALLET_TRANSFER_FEE: 'wallet.transferFee',
  CONTACT_COMPANY_NAME: 'contact.companyName',
  CONTACT_SUPPORT_EMAIL: 'contact.supportEmail',
  CONTACT_SUPPORT_PHONE: 'contact.supportPhone',
  CONTACT_WHATSAPP: 'contact.whatsapp',
  CONTACT_WEBSITE: 'contact.website',
  CONTACT_ADDRESS: 'contact.address',
  CONTACT_BUSINESS_HOURS: 'contact.businessHours',
  CONTACT_FACEBOOK: 'contact.facebook',
  CONTACT_INSTAGRAM: 'contact.instagram',
  CONTACT_TWITTER: 'contact.twitter',
  CONTACT_TIKTOK: 'contact.tiktok',
  COMMISSION_DEFAULT_ROOKIE: 'commission.default.rookie',
  COMMISSION_DEFAULT_STANDARD: 'commission.default.standard',
  COMMISSION_DEFAULT_SILVER: 'commission.default.silver',
  COMMISSION_DEFAULT_GOLD: 'commission.default.gold',
  COMMISSION_DEFAULT_PLATINUM: 'commission.default.platinum',
  COMMISSION_DEFAULT_DIAMOND: 'commission.default.diamond',
  COMMISSION_DEFAULT_ELITE: 'commission.default.elite',
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

    this.cache.set(key, {
      value: setting.value,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });
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

  /**
   * A narrow, explicitly-whitelisted public read — not a general
   * "expose settings publicly" endpoint. Only these specific fields,
   * never the full table, so something like the cash-debt threshold or
   * referral bonus amounts never accidentally becomes publicly
   * readable just because a new setting was added later.
   */
  async getContactInfo() {
    const [
      companyName,
      supportEmail,
      supportPhone,
      whatsapp,
      website,
      address,
      businessHours,
      facebook,
      instagram,
      twitter,
      tiktok,
    ] = await Promise.all([
      this.getString(SETTING_KEYS.CONTACT_COMPANY_NAME, 'Ryda'),
      this.getString(SETTING_KEYS.CONTACT_SUPPORT_EMAIL, ''),
      this.getString(SETTING_KEYS.CONTACT_SUPPORT_PHONE, ''),
      this.getString(SETTING_KEYS.CONTACT_WHATSAPP, ''),
      this.getString(SETTING_KEYS.CONTACT_WEBSITE, ''),
      this.getString(SETTING_KEYS.CONTACT_ADDRESS, ''),
      this.getString(SETTING_KEYS.CONTACT_BUSINESS_HOURS, ''),
      this.getString(SETTING_KEYS.CONTACT_FACEBOOK, ''),
      this.getString(SETTING_KEYS.CONTACT_INSTAGRAM, ''),
      this.getString(SETTING_KEYS.CONTACT_TWITTER, ''),
      this.getString(SETTING_KEYS.CONTACT_TIKTOK, ''),
    ]);
    return {
      companyName,
      supportEmail,
      supportPhone,
      whatsapp,
      website,
      address,
      businessHours,
      facebook,
      instagram,
      twitter,
      tiktok,
    };
  }

  async listAll(): Promise<SystemSetting[]> {
    return this.repo.find({ order: { key: 'ASC' } });
  }

  async set(
    key: string,
    updatedBy: string,
    dto: UpsertSettingDto,
  ): Promise<SystemSetting> {
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
