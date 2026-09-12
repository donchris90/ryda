import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface VoiceCallEntry {
  phoneNumber: string;
  status: string;
  sessionId: string;
}

export interface VoiceCallResult {
  success: boolean;
  entries?: VoiceCallEntry[];
  error?: string;
}

/**
 * Thin client over Africa's Talking' Voice API
 * (https://developers.africastalking.com/docs/voice/overview).
 *
 * Used for masked ride calls (CallsService) so a passenger and driver
 * can reach each other without either side ever seeing the other's
 * real phone number. Deliberately a separate provider from
 * AfricasTalkingProvider (SMS) even though it shares the same account
 * credentials — Voice and SMS are different AT products with different
 * base URLs and payload shapes, and keeping them independent matches
 * this project's existing pattern of one thin client per provider
 * capability (see otp/providers/africas-talking.provider.ts for the
 * same reasoning applied to OTP vs general SMS).
 *
 * Flow for a masked call (see CallsService for the full picture):
 *   1. We call initiateCall() to dial the initiator's real number
 *      from our AT voice-enabled virtual number.
 *   2. When the initiator answers, Africa's Talking requests our
 *      registered Voice Callback URL (CallsController.voiceCallback).
 *   3. That handler responds with AT's Voice XML to bridge the call
 *      to the other party's real number — never returning either
 *      number to a client app.
 *
 * Same graceful-fallback pattern as every other external integration
 * in this project: falls back to a clearly logged dev-mode path when
 * unconfigured, so the rest of the system stays testable without real
 * credentials.
 */
@Injectable()
export class AfricasTalkingVoiceProvider {
  private readonly logger = new Logger(AfricasTalkingVoiceProvider.name);
  private readonly apiKey: string;
  private readonly username: string;
  private readonly voiceNumber: string;
  private readonly baseUrl: string;

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.get<string>('africasTalking.apiKey') ?? '';
    this.username = this.config.get<string>('africasTalking.username') ?? '';
    this.voiceNumber = this.config.get<string>('africasTalking.voiceNumber') ?? '';
    this.baseUrl = this.config.get<string>('africasTalking.voiceBaseUrl')!;
  }

  isConfigured(): boolean {
    return !!(this.apiKey && this.username && this.voiceNumber);
  }

  /**
   * Dials `to` (E.164) from the shared AT voice-enabled number. Returns
   * the sessionId AT assigns to this call leg — the only handle we have
   * to correlate the later voice callback with who should be bridged in.
   */
  async initiateCall(to: string): Promise<VoiceCallResult> {
    if (!this.isConfigured()) {
      this.logger.warn(`[DEV MODE] Would call ${to} via Africa's Talking Voice (not configured)`);
      return { success: false, error: "Africa's Talking Voice not configured" };
    }

    const params = new URLSearchParams({
      username: this.username,
      from: this.voiceNumber,
      to,
    });

    try {
      const response = await fetch(`${this.baseUrl}/call`, {
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
        this.logger.warn(`Africa's Talking Voice call failed: HTTP ${response.status}`);
        return { success: false, error: `HTTP ${response.status}` };
      }

      const entries: VoiceCallEntry[] = json?.entries ?? [];
      if (!entries.length) {
        this.logger.warn("Africa's Talking Voice response had no call entries");
        return { success: false, error: 'Malformed provider response' };
      }

      return { success: true, entries };
    } catch (err) {
      this.logger.error("Africa's Talking Voice request failed", err as Error);
      return { success: false, error: (err as Error).message };
    }
  }
}
