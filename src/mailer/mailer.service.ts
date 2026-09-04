import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);
  private readonly apiKey: string;
  private readonly fromEmail: string;
  private readonly fromName: string;

  // Brevo's transactional email API, not SMTP - deliberately, not as a
  // preference. Render's free tier blocks all outbound traffic on the
  // SMTP ports (25, 465, 587), which is exactly what broke the
  // original nodemailer/Gmail-SMTP setup (every send failed with
  // "Connection timeout", not an auth error - the connection never
  // even reached Gmail). This endpoint is a normal HTTPS POST, so it
  // goes out over port 443 like every other API call this backend
  // already makes (Google Maps, Paystack) - nothing free-tier Render
  // blocks.
  private readonly apiUrl = 'https://api.brevo.com/v3/smtp/email';

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.get<string>('mail.brevoApiKey') ?? '';
    this.fromEmail = this.config.get<string>('mail.user') ?? '';
    this.fromName = this.config.get<string>('mail.fromName')!;

    if (!this.apiKey || !this.fromEmail) {
      this.logger.warn('BREVO_API_KEY/GMAIL_USER not set — emails will be logged, not actually sent (see README)');
    }
  }

  isConfigured(): boolean {
    return !!this.apiKey && !!this.fromEmail;
  }

  /**
   * Never throws on send failure - a bounced or slow-to-send email
   * should not fail the API call that triggered it (registration,
   * password reset request). Same reasoning as SMS OTP delivery being
   * fire-and-forget elsewhere in this codebase.
   */
  /**
   * Still never throws - a bounced or slow-to-send email should not
   * fail the API call that triggered it (registration, password reset
   * request), same reasoning as SMS OTP delivery being fire-and-forget
   * elsewhere in this codebase. Now returns a result instead of
   * silently swallowing it, though, so a caller that DOES care whether
   * the send actually worked (NotificationsService's email failover)
   * can tell - existing callers that only `await` this and ignore the
   * return value are unaffected.
   */
  async send(to: string, subject: string, html: string): Promise<{ success: boolean; error?: string }> {
    if (!this.isConfigured()) {
      this.logger.log(`[DEV MAIL - not actually sent] To: ${to} | Subject: ${subject}\n${html}`);
      return { success: false, error: 'Brevo not configured' };
    }

    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'api-key': this.apiKey,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          sender: { name: this.fromName, email: this.fromEmail },
          to: [{ email: to }],
          subject,
          htmlContent: html,
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        const body = await response.text();
        this.logger.error(`Brevo send to ${to} failed (${response.status}): ${body}`);
        return { success: false, error: `Brevo responded ${response.status}` };
      }
      return { success: true };
    } catch (err) {
      this.logger.error(`Failed to send email to ${to}: ${(err as Error).message}`);
      return { success: false, error: (err as Error).message };
    }
  }
}
