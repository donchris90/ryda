import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes, createHash } from 'crypto';
import { ApiKey } from './entities/api-key.entity';
import { CreateApiKeyDto } from './dto/api-key.dto';

@Injectable()
export class ApiKeysService {
  constructor(
    @InjectRepository(ApiKey)
    private readonly repo: Repository<ApiKey>,
  ) {}

  /** Returns the raw key exactly once — the caller must save it now, it's never retrievable again. */
  async create(dto: CreateApiKeyDto): Promise<{ apiKey: ApiKey; rawKey: string }> {
    const rawKey = `rk_${randomBytes(24).toString('hex')}`;
    const hashedKey = this.hash(rawKey);

    const apiKey = await this.repo.save(
      this.repo.create({
        name: dto.name,
        hashedKey,
        keyPrefix: rawKey.slice(0, 12),
        scopes: dto.scopes ?? [],
      }),
    );

    return { apiKey, rawKey };
  }

  async validate(rawKey: string): Promise<ApiKey | null> {
    const hashedKey = this.hash(rawKey);
    const apiKey = await this.repo.findOne({ where: { hashedKey, isActive: true } });
    if (!apiKey) return null;

    apiKey.lastUsedAt = new Date();
    await this.repo.save(apiKey);
    return apiKey;
  }

  async list(): Promise<ApiKey[]> {
    return this.repo.find({ order: { createdAt: 'DESC' } });
  }

  async revoke(id: string): Promise<void> {
    await this.repo.update(id, { isActive: false });
  }

  private hash(rawKey: string): string {
    return createHash('sha256').update(rawKey).digest('hex');
  }
}
