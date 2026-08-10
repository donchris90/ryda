import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);
  private transporter: nodemailer.Transporter | null = null;

  constructor(private readonly config: ConfigService) {
    const user = this.config.get<string>('mail.user')!;
    const appPassword = this.config.get<string>('mail.appPassword')!;

    if (user && appPassword) {
      this.transporter = nodemailer.createTransport({
        host: this.config.get<string>('mail.host')!,
        port: this.config.get<number>('mail.port')!,
        secure: this.config.get<boolean>('mail.secure')!,
        auth: { user, pass: appPassword },
      });
    } else {
      this.logger.warn('GMAIL_USER/GMAIL_APP_PASSWORD not set — emails will be logged, not actually sent (see README)');
    }
  }

  isConfigured(): boolean {
    return this.transporter !== null;
  }

  /**
   * Never throws on send failure - a bounced or slow-to-send email
   * should not fail the API call that triggered it (registration,
   * password reset request). Same reasoning as SMS OTP delivery being
   * fire-and-forget elsewhere in this codebase.
   */
  async send(to: string, subject: string, html: string): Promise<void> {
    if (!this.transporter) {
      this.logger.log(`[DEV MAIL - not actually sent] To: ${to} | Subject: ${subject}\n${html}`);
      return;
    }

    try {
      const fromName = this.config.get<string>('mail.fromName')!;
      const user = this.config.get<string>('mail.user')!;
      await this.transporter.sendMail({
        from: `"${fromName}" <${user}>`,
        to,
        subject,
        html,
      });
    } catch (err) {
      this.logger.error(`Failed to send email to ${to}: ${(err as Error).message}`);
    }
  }
}
