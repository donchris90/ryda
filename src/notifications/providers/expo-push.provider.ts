import { Injectable, Logger } from '@nestjs/common';
import { ProviderSendResult } from './provider-result';

/**
 * Sends via Expo's push notification service, not FCM/APNs directly.
 *
 * This is the correct provider for this project specifically: both the
 * passenger and driver apps are Expo apps using expo-notifications'
 * `getExpoPushTokenAsync()`, which produces an `ExponentPushToken[...]`
 * string — a fundamentally different format from a raw FCM registration
 * token. The previously-existing `FcmProvider` sent tokens straight to
 * FCM's HTTP API expecting raw FCM tokens, which would have silently
 * rejected every Expo push token this project's own clients register.
 * Found and fixed while wiring up the driver app's ride-offer
 * notifications, which need to actually reach a device to be useful.
 *
 * Expo's push API needs no server credentials at all — no Firebase
 * project, no service account, nothing to configure — which is also why
 * it's a better fit here than standing up real FCM/APNs credentials for
 * a project that doesn't have them yet. `FcmProvider` remains available
 * for a possible future bare-React-Native client that would register raw
 * FCM tokens instead, but nothing in this project currently produces
 * those.
 */
@Injectable()
export class ExpoPushProvider {
  private readonly logger = new Logger(ExpoPushProvider.name);
  private readonly endpoint = 'https://exp.host/--/api/v2/push/send';

  isConfigured(): boolean {
    return true; // no credentials needed — always available
  }

  isExpoPushToken(token: string): boolean {
    return token.startsWith('ExponentPushToken[') || token.startsWith('ExpoPushToken[');
  }

  async sendPush(
    deviceToken: string,
    title: string,
    body: string,
    data?: Record<string, string>,
  ): Promise<ProviderSendResult> {
    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Accept-Encoding': 'gzip, deflate',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ to: deviceToken, title, body, data }),
      });
      const json = await response.json().catch(() => ({}) as any);
      const ticket = Array.isArray(json?.data) ? json.data[0] : json?.data;

      if (!response.ok || ticket?.status === 'error') {
        const error = ticket?.message ?? `HTTP ${response.status}`;
        this.logger.warn(`Expo push send failed: ${error}`);
        return { success: false, error };
      }
      return { success: true, providerReference: ticket?.id };
    } catch (err) {
      this.logger.error('Expo push request failed', err as Error);
      return { success: false, error: (err as Error).message };
    }
  }
}
