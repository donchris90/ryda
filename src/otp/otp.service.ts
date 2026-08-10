import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { OtpCode, OtpPurpose } from './otp-code.entity';

const MAX_ATTEMPTS = 5;

@Injectable()
export class OtpService {
  constructor(
    @InjectRepository(OtpCode)
    private readonly otpRepo: Repository<OtpCode>,
    private readonly config: ConfigService,
  ) {}

  async send(destination: string, purpose: OtpPurpose): Promise<{ devOnlyCode: string; expiresInSeconds: number }> {
    const length = this.config.get<number>('otp.length')!;
    const ttlSeconds = this.config.get<number>('otp.ttlSeconds')!;
    const code = this.generateCode(length);

    await this.otpRepo.save(
      this.otpRepo.create({
        destination,
        purpose,
        code,
        expiresAt: new Date(Date.now() + ttlSeconds * 1000),
      }),
    );

    // TODO: wire to an SMS provider (Twilio, Termii, etc). For now the code
    // is returned directly so every flow that uses this stays testable
    // end-to-end without one.
    return { devOnlyCode: code, expiresInSeconds: ttlSeconds };
  }

  /**
   * Throws on any failure (expired, wrong code, too many attempts,
   * nothing pending) rather than returning false - every current
   * caller needs a real error message for the person to see, not a
   * boolean to re-derive one from.
   */
  async verify(destination: string, code: string, purpose: OtpPurpose): Promise<void> {
    const latest = await this.otpRepo.findOne({
      where: { destination, purpose, isUsed: false },
      order: { createdAt: 'DESC' },
    });

    if (!latest || latest.expiresAt < new Date()) {
      throw new BadRequestException('Invalid or expired OTP');
    }

    if (latest.attemptCount >= MAX_ATTEMPTS) {
      throw new BadRequestException('Too many incorrect attempts — request a new code');
    }

    if (latest.code !== code) {
      latest.attemptCount += 1;
      await this.otpRepo.save(latest);
      throw new BadRequestException('Invalid or expired OTP');
    }

    latest.isUsed = true;
    await this.otpRepo.save(latest);
  }

  private generateCode(length: number): string {
    const digits = '0123456789';
    let code = '';
    for (let i = 0; i < length; i++) {
      code += digits[Math.floor(Math.random() * digits.length)];
    }
    return code;
  }
}
