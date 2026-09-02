import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { AuditLog } from './entities/audit-log.entity';

export interface AuditLogFilters {
  actorUserId?: string;
  action?: string;
  targetId?: string;
  from?: Date;
  to?: Date;
  page?: number;
  pageSize?: number;
}

const SENSITIVE_FIELDS = ['password', 'passwordHash', 'refreshToken', 'accessToken', 'authorizationCode'];

@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditLog)
    private readonly repo: Repository<AuditLog>,
  ) {}

  async log(entry: {
    actorUserId: string | null;
    actorRole: string | null;
    action: string;
    targetType?: string;
    targetId?: string | null;
    metadata?: Record<string, unknown>;
    ipAddress?: string | null;
  }): Promise<void> {
    await this.repo.save(
      this.repo.create({
        actorUserId: entry.actorUserId,
        actorRole: entry.actorRole,
        action: entry.action,
        targetType: entry.targetType ?? null,
        targetId: entry.targetId ?? null,
        metadata: entry.metadata ? this.redact(entry.metadata) : null,
        ipAddress: entry.ipAddress ?? null,
      }),
    );
  }

  async find(filters: AuditLogFilters): Promise<{ data: AuditLog[]; total: number; page: number; pageSize: number }> {
    const page = filters.page ?? 1;
    const pageSize = Math.min(filters.pageSize ?? 50, 200);

    const qb = this.repo.createQueryBuilder('log').orderBy('log.createdAt', 'DESC');

    if (filters.actorUserId) qb.andWhere('log.actorUserId = :actorUserId', { actorUserId: filters.actorUserId });
    if (filters.action) qb.andWhere('log.action = :action', { action: filters.action });
    if (filters.targetId) qb.andWhere('log.targetId = :targetId', { targetId: filters.targetId });
    if (filters.from && filters.to) {
      qb.andWhere({ createdAt: Between(filters.from, filters.to) });
    }

    qb.skip((page - 1) * pageSize).take(pageSize);

    const [data, total] = await qb.getManyAndCount();
    return { data, total, page, pageSize };
  }

  private redact(metadata: Record<string, unknown>): Record<string, unknown> {
    const clone: Record<string, unknown> = { ...metadata };
    for (const field of SENSITIVE_FIELDS) {
      if (field in clone) clone[field] = '[redacted]';
    }
    return clone;
  }
}
