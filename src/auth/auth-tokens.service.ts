import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { AuthToken, AuthTokenPurpose } from './entities/auth-token.entity';

@Injectable()
export class AuthTokensService {
  constructor(
    @InjectRepository(AuthToken)
    private readonly tokensRepo: Repository<AuthToken>,
    private readonly config: ConfigService,
  ) {}

  async issue(userId: string, purpose: AuthTokenPurpose): Promise<string> {
    const token = randomBytes(32).toString('hex');
    const ttlMs =
      purpose === AuthTokenPurpose.EMAIL_VERIFICATION
        ? this.config.get<number>('mail.verificationTtlHours')! * 60 * 60 * 1000
        : this.config.get<number>('mail.passwordResetTtlMinutes')! * 60 * 1000;

    await this.tokensRepo.save(
      this.tokensRepo.create({
        userId,
        token,
        purpose,
        expiresAt: new Date(Date.now() + ttlMs),
      }),
    );

    return token;
  }

  /**
   * Returns the userId on success, throws otherwise. A single-use
   * check (isUsed) plus purpose scoping means a leaked verification
   * link can't be replayed and can't be repurposed as a password-reset
   * token even though both are the same underlying entity shape.
   */
  async consume(token: string, purpose: AuthTokenPurpose): Promise<string> {
    const record = await this.tokensRepo.findOne({ where: { token, purpose } });
    if (!record || record.isUsed) {
      throw new BadRequestException('Invalid or already-used link');
    }
    if (record.expiresAt < new Date()) {
      throw new BadRequestException('This link has expired');
    }

    record.isUsed = true;
    await this.tokensRepo.save(record);

    return record.userId;
  }
}
