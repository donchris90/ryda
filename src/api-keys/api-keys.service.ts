import { Injectable, NotFoundException } from '@nestjs/common';
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
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      }),
    );

    return { apiKey, rawKey };
  }

  async validate(rawKey: string): Promise<ApiKey | null> {
    const hashedKey = this.hash(rawKey);
    const apiKey = await this.repo.findOne({ where: { hashedKey, isActive: true } });
    if (!apiKey) return null;
    if (apiKey.expiresAt && apiKey.expiresAt < new Date()) return null;

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

  /**
   * Issues a brand-new key/secret under the same name and scopes, then
   * revokes the old one — the standard "rotate" flow so a partner can pick
   * up the new key before the old one stops working, rather than an
   * instant swap that would break them mid-integration. Same one-time
   * raw-key-reveal contract as create().
   */
  async rotate(id: string): Promise<{ apiKey: ApiKey; rawKey: string }> {
    const existing = await this.repo.findOne({ where: { id } });
    if (!existing) throw new NotFoundException('API key not found');

    const result = await this.create({
      name: existing.name,
      scopes: existing.scopes,
      expiresAt: existing.expiresAt?.toISOString(),
    });
    await this.revoke(id);
    return result;
  }

  private hash(rawKey: string): string {
    return createHash('sha256').update(rawKey).digest('hex');
  }
}
