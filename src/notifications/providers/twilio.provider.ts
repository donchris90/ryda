import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ProviderSendResult } from './provider-result';

/**
 * Thin client over Twilio's REST API (https://www.twilio.com/docs/sms/api).
 * Used for both SMS and WhatsApp — Twilio's Messages endpoint handles both,
 * differing only in the `From`/`To` prefix (`whatsapp:+1...`).
 */
@Injectable()
export class TwilioProvider {
  private readonly logger = new Logger(TwilioProvider.name);
  private readonly accountSid: string;
  private readonly authToken: string;
  private readonly fromNumber: string;
  private readonly whatsappFromNumber: string;

  constructor(private readonly config: ConfigService) {
    this.accountSid = this.config.get<string>('twilio.accountSid') ?? '';
    this.authToken = this.config.get<string>('twilio.authToken') ?? '';
    this.fromNumber = this.config.get<string>('twilio.fromNumber') ?? '';
    this.whatsappFromNumber = this.config.get<string>('twilio.whatsappFromNumber') ?? '';
  }

  isSmsConfigured(): boolean {
    return !!(this.accountSid && this.authToken && this.fromNumber);
  }

  isWhatsappConfigured(): boolean {
    return !!(this.accountSid && this.authToken && this.whatsappFromNumber);
  }

  async sendSms(to: string, body: string): Promise<ProviderSendResult> {
    return this.sendMessage(this.fromNumber, to, body);
  }

  async sendWhatsapp(to: string, body: string): Promise<ProviderSendResult> {
    return this.sendMessage(this.whatsappFromNumber, `whatsapp:${to}`, body);
  }

  private async sendMessage(from: string, to: string, body: string): Promise<ProviderSendResult> {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`;
    const auth = Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64');
    const params = new URLSearchParams({ From: from, To: to, Body: body });

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });
      const json = await response.json().catch(() => ({}) as any);

      if (!response.ok) {
        this.logger.warn(`Twilio send failed: ${json.message ?? response.status}`);
        return { success: false, error: json.message ?? `HTTP ${response.status}` };
      }
      return { success: true, providerReference: json.sid };
    } catch (err) {
      this.logger.error('Twilio request failed', err as Error);
      return { success: false, error: (err as Error).message };
    }
  }
}
