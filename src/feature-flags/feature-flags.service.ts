import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FeatureFlag } from './entities/feature-flag.entity';
import { UpsertFeatureFlagDto } from './dto/feature-flag.dto';

/** Well-known flag keys used elsewhere in the codebase via @RequireFeature(). */
export const FEATURE_KEYS = {
  RIDE_SHARING: 'ride_sharing',
  AIRPORT_MODULE: 'airport_module',
  LOGISTICS: 'logistics',
  PROMOTIONS: 'promotions',
  AI_DISPATCH: 'ai_dispatch',
} as const;

const DEFAULT_FLAGS: Array<{ key: string; name: string; description: string }> =
  [
    {
      key: FEATURE_KEYS.RIDE_SHARING,
      name: 'Ride Sharing',
      description:
        'Ride pooling — batch-matches compatible Economy requests into a shared trip at a discount before dispatching a driver. See PoolMatchingService.',
    },
    {
      key: FEATURE_KEYS.AIRPORT_MODULE,
      name: 'Airport Module',
      description: 'Airport registry, geofence detection, driver pickup queue',
    },
    {
      key: FEATURE_KEYS.LOGISTICS,
      name: 'Logistics',
      description: 'Parcel/food/grocery/pharmacy/courier delivery',
    },
    {
      key: FEATURE_KEYS.PROMOTIONS,
      name: 'Promotions',
      description: 'Promo code redemption on ride requests',
    },
    {
      key: FEATURE_KEYS.AI_DISPATCH,
      name: 'AI Dispatch',
      description:
        'Weighted driver ranking in smart dispatch (falls back to plain nearest-first when off)',
    },
  ];

@Injectable()
export class FeatureFlagsService implements OnModuleInit {
  constructor(
    @InjectRepository(FeatureFlag)
    private readonly repo: Repository<FeatureFlag>,
  ) {}

  /** Seeds the known flags as enabled on first boot — never disables anything by surprise. */
  async onModuleInit(): Promise<void> {
    for (const flag of DEFAULT_FLAGS) {
      const existing = await this.repo.findOne({ where: { key: flag.key } });
      if (!existing) {
        await this.repo.save(this.repo.create({ ...flag, isEnabled: true }));
      }
    }
  }

  /** Fail-open for unknown keys — a typo in a flag key shouldn't silently disable a feature. */
  async isEnabled(key: string): Promise<boolean> {
    const flag = await this.repo.findOne({ where: { key } });
    return flag ? flag.isEnabled : true;
  }

  async listAll(): Promise<FeatureFlag[]> {
    return this.repo.find({ order: { key: 'ASC' } });
  }

  async upsert(
    key: string,
    updatedBy: string,
    dto: UpsertFeatureFlagDto,
  ): Promise<FeatureFlag> {
    let flag = await this.repo.findOne({ where: { key } });
    if (!flag) {
      flag = this.repo.create({ key, name: dto.name ?? key });
    }
    if (dto.name) flag.name = dto.name;
    if (dto.description !== undefined) flag.description = dto.description;
    flag.isEnabled = dto.isEnabled;
    flag.updatedBy = updatedBy;
    return this.repo.save(flag);
  }
}
