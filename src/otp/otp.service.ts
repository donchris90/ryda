import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { OtpCode, OtpPurpose } from './otp-code.entity';
import { TwilioProvider } from '../notifications/providers/twilio.provider';

const MAX_ATTEMPTS = 5;

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  constructor(
    @InjectRepository(OtpCode)
    private readonly otpRepo: Repository<OtpCode>,
    private readonly config: ConfigService,
    private readonly twilio: TwilioProvider,
  ) {}

  async send(destination: string, purpose: OtpPurpose): Promise<{ devOnlyCode: string | null; expiresInSeconds: number; delivered: boolean }> {
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

    // destination is always a phone number for every current caller
    // (PHONE_VERIFICATION, WALLET_TRANSFER, WALLET_WITHDRAWAL all pass
    // dto.phone/user.phone) - attempt real SMS delivery via the same
    // Twilio account notifications already use, rather than silently
    // never sending anything.
    let delivered = false;
    if (this.twilio.isSmsConfigured()) {
      const result = await this.twilio.sendSms(destination, `Your Ryda verification code is ${code}. It expires in ${Math.round(ttlSeconds / 60)} minutes. Never share this code with anyone.`);
      delivered = result.success;
      if (!result.success) {
        this.logger.warn(`OTP SMS delivery failed for purpose=${purpose}: ${result.error}`);
      }
    } else {
      this.logger.warn('TWILIO not configured — OTP SMS not actually sent (see devOnlyCode fallback in README)');
    }

    // Only ever surface the real code here when it genuinely wasn't
    // delivered anywhere else - once SMS delivery succeeds, the code
    // must not also be readable straight from this response.
    return { devOnlyCode: delivered ? null : code, expiresInSeconds: ttlSeconds, delivered };
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
