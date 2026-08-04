import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ProviderSendResult } from './provider-result';

/**
 * Thin client over FCM's legacy HTTP server-key API. Simplest option to
 * wire without an OAuth2 service-account flow, but Google has deprecated
 * this endpoint in favor of FCM HTTP v1 — migrate before relying on this
 * for production push volume.
 */
@Injectable()
export class FcmProvider {
  private readonly logger = new Logger(FcmProvider.name);
  private readonly serverKey: string;

  constructor(private readonly config: ConfigService) {
    this.serverKey = this.config.get<string>('fcm.serverKey') ?? '';
  }

  isConfigured(): boolean {
    return this.serverKey.length > 0;
  }

  async sendPush(
    deviceToken: string,
    title: string,
    body: string,
    data?: Record<string, string>,
  ): Promise<ProviderSendResult> {
    try {
      const response = await fetch('https://fcm.googleapis.com/fcm/send', {
        method: 'POST',
        headers: {
          Authorization: `key=${this.serverKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          to: deviceToken,
          notification: { title, body },
          data,
        }),
      });
      const json = await response.json().catch(() => ({}) as any);

      if (!response.ok || json.failure > 0) {
        const error = json.results?.[0]?.error ?? `HTTP ${response.status}`;
        this.logger.warn(`FCM send failed: ${error}`);
        return { success: false, error };
      }
      return { success: true, providerReference: json.multicast_id?.toString() };
    } catch (err) {
      this.logger.error('FCM request failed', err as Error);
      return { success: false, error: (err as Error).message };
    }
  }
}
