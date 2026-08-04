import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ProviderSendResult } from './provider-result';

/** Thin client over SendGrid's v3 Mail Send API. */
@Injectable()
export class SendGridProvider {
  private readonly logger = new Logger(SendGridProvider.name);
  private readonly apiKey: string;
  private readonly fromEmail: string;

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.get<string>('sendgrid.apiKey') ?? '';
    this.fromEmail = this.config.get<string>('sendgrid.fromEmail')!;
  }

  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  async sendEmail(to: string, subject: string, body: string): Promise<ProviderSendResult> {
    try {
      const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: to }] }],
          from: { email: this.fromEmail },
          subject,
          content: [{ type: 'text/plain', value: body }],
        }),
      });

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}) as any);
        const message = errBody.errors?.[0]?.message ?? `HTTP ${response.status}`;
        this.logger.warn(`SendGrid send failed: ${message}`);
        return { success: false, error: message };
      }
      // SendGrid returns the message id in the X-Message-Id header, not the body.
      return { success: true, providerReference: response.headers.get('x-message-id') ?? undefined };
    } catch (err) {
      this.logger.error('SendGrid request failed', err as Error);
      return { success: false, error: (err as Error).message };
    }
  }
}
