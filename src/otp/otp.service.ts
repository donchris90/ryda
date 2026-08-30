import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { OtpCode, OtpPurpose } from './otp-code.entity';
import { AfricasTalkingProvider } from './providers/africas-talking.provider';

const MAX_ATTEMPTS = 5;

// A destination containing '@' is an email (e.g. wallet-transfer OTPs,
// which are delivered by MailerService using the code this method
// returns) - anything else is treated as a phone number and is the only
// case this service ever attempts to SMS directly.
const isEmailDestination = (destination: string): boolean => destination.includes('@');

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  constructor(
    @InjectRepository(OtpCode)
    private readonly otpRepo: Repository<OtpCode>,
    private readonly config: ConfigService,
    private readonly africasTalking: AfricasTalkingProvider,
  ) {}

  /**
   * `devOnlyCode` is still always returned - some callers (wallet-transfer
   * confirmation) never SMS the destination at all and instead embed this
   * value in an email they send themselves, so the field can't simply
   * disappear once a real SMS provider is configured.
   *
   * `smsSent` is the new signal: true only when this method itself just
   * delivered the code over a real channel. Callers that hand the raw
   * code straight back in an API response (see AuthService.sendOtp())
   * must stop doing that once smsSent is true - the code has already
   * been delivered out-of-band at that point, and echoing it back in the
   * response would defeat the entire point of sending it by SMS.
   */
  async send(
    destination: string,
    purpose: OtpPurpose,
  ): Promise<{ devOnlyCode: string; expiresInSeconds: number; smsSent: boolean }> {
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

    let smsSent = false;
    if (!isEmailDestination(destination) && this.africasTalking.isConfigured()) {
      const result = await this.africasTalking.sendSms(
        destination,
        `Your Ryda verification code is ${code}. It expires in ${Math.round(ttlSeconds / 60)} minutes.`,
      );
      if (result.success) {
        smsSent = true;
      } else {
        // Never fail the calling operation over a delivery problem -
        // same "log, don't throw" guarantee every other notification
        // provider in this project follows. The code is still valid and
        // still returned below, so a dev/staging caller without working
        // SMS can keep testing the flow end-to-end.
        this.logger.warn(`SMS OTP send failed for ${purpose}: ${result.error}`);
      }
    }

    return { devOnlyCode: code, expiresInSeconds: ttlSeconds, smsSent };
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
