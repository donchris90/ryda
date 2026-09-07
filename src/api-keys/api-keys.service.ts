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

  /**
   * Same raw-key contract as create() (returned exactly once, then
   * never again) - name, scopes, and expiresAt all carry over from the
   * existing record; only the actual secret changes. lastUsedAt resets
   * to null since it genuinely hasn't been used yet under the new
   * secret - the old value would misleadingly suggest recent activity
   * under a key that no longer exists in any usable form.
   */
  async rotate(id: string): Promise<{ apiKey: ApiKey; rawKey: string }> {
    const existing = await this.repo.findOne({ where: { id } });
    if (!existing) throw new NotFoundException('API key not found');

    const rawKey = `rk_${randomBytes(24).toString('hex')}`;
    existing.hashedKey = this.hash(rawKey);
    existing.keyPrefix = rawKey.slice(0, 12);
    existing.lastUsedAt = null;

    const apiKey = await this.repo.save(existing);
    return { apiKey, rawKey };
  }

  async validate(rawKey: string): Promise<ApiKey | null> {
    const hashedKey = this.hash(rawKey);
    const apiKey = await this.repo.findOne({ where: { hashedKey, isActive: true } });
    if (!apiKey) return null;

    // Enforced here, not just displayed - the admin dashboard already
    // shows an "Expired" badge computed from this same field
    // (api-keys.tsx), which only makes sense if an expired key actually
    // stops authenticating. Treated the same as inactive/not-found
    // (a plain null, not a distinct error) - a partner hitting an
    // expired key should see the same generic auth failure as any other
    // invalid key, not a signal that tells them exactly why (which key
    // format is even valid, whether the key ever existed, etc.).
    if (apiKey.expiresAt && apiKey.expiresAt.getTime() < Date.now()) return null;

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
