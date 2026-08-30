import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ProviderSendResult } from '../../notifications/providers/provider-result';

/**
 * Thin client over Africa's Talking' SMS API
 * (https://developers.africastalking.com/docs/sms/overview) — used
 * specifically for OTP delivery, kept independent of the Notifications
 * module's Twilio/SendGrid/FCM providers by design (see OtpService's
 * class doc comment: OTP has different urgency/retry requirements than
 * general notifications, so it doesn't route through NotificationsService).
 *
 * Same graceful-fallback pattern as every other external integration in
 * this project (Paystack, Maps, Twilio, ...): falls back to a clearly
 * logged dev-mode path when unconfigured, so the rest of the system
 * stays testable without real credentials.
 */
@Injectable()
export class AfricasTalkingProvider {
  private readonly logger = new Logger(AfricasTalkingProvider.name);
  private readonly apiKey: string;
  private readonly username: string;
  private readonly senderId: string;
  private readonly baseUrl: string;

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.get<string>('africasTalking.apiKey') ?? '';
    this.username = this.config.get<string>('africasTalking.username') ?? '';
    this.senderId = this.config.get<string>('africasTalking.senderId') ?? '';
    this.baseUrl = this.config.get<string>('africasTalking.baseUrl')!;
  }

  isConfigured(): boolean {
    return !!(this.apiKey && this.username);
  }

  async sendSms(to: string, message: string): Promise<ProviderSendResult> {
    if (!this.isConfigured()) {
      return { success: false, error: 'Africa\'s Talking not configured' };
    }

    const params = new URLSearchParams({
      username: this.username,
      to,
      message,
    });
    if (this.senderId) {
      params.set('from', this.senderId);
    }

    try {
      const response = await fetch(`${this.baseUrl}/messaging`, {
        method: 'POST',
        headers: {
          apiKey: this.apiKey,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: params.toString(),
      });

      const json = await response.json().catch(() => ({}) as any);

      if (!response.ok) {
        this.logger.warn(`Africa's Talking send failed: HTTP ${response.status}`);
        return { success: false, error: `HTTP ${response.status}` };
      }

      // Africa's Talking returns 200 even for a per-recipient failure —
      // the real outcome is inside SMSMessageData.Recipients[]. A 2xx
      // response with a rejected recipient is NOT the same as a
      // successful send and must not be reported as one.
      const recipient = json?.SMSMessageData?.Recipients?.[0];
      if (!recipient) {
        this.logger.warn('Africa\'s Talking response had no recipient data');
        return { success: false, error: 'Malformed provider response' };
      }

      // statusCode 100/101 = queued/sent successfully. Anything else
      // (e.g. 401 insufficient balance, 405 invalid sender id, 500
      // internal error) is a real failure even though the HTTP call
      // itself returned 200.
      const isSuccess = recipient.statusCode === 100 || recipient.statusCode === 101;
      if (!isSuccess) {
        this.logger.warn(`Africa's Talking rejected recipient: ${recipient.status} (${recipient.statusCode})`);
        return { success: false, error: recipient.status ?? 'Send rejected' };
      }

      return { success: true, providerReference: recipient.messageId };
    } catch (err) {
      this.logger.error("Africa's Talking request failed", err as Error);
      return { success: false, error: (err as Error).message };
    }
  }
}
