import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes, createHmac } from 'crypto';
import { OnEvent } from '@nestjs/event-emitter';
import { WebhookSubscription } from './entities/webhook-subscription.entity';
import { WebhookDeliveryLog, WebhookDeliveryStatus } from './entities/webhook-delivery-log.entity';
import { CreateWebhookSubscriptionDto, UpdateWebhookSubscriptionDto } from './dto/webhook.dto';
import { assertPublicUrl } from './assert-public-url';

/** Every domain event a partner can subscribe to. */
export const WEBHOOK_EVENTS = [
  'ride.created',
  'ride.accepted',
  'ride.started',
  'ride.completed',
  'ride.cancelled',
  'payment.confirmed',
  'payment.failed',
  'wallet.updated',
  'driver.online',
  'driver.offline',
  'promotion.redeemed',
] as const;

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    @InjectRepository(WebhookSubscription)
    private readonly subscriptionsRepo: Repository<WebhookSubscription>,
    @InjectRepository(WebhookDeliveryLog)
    private readonly logsRepo: Repository<WebhookDeliveryLog>,
  ) {}

  async subscribe(dto: CreateWebhookSubscriptionDto): Promise<{ subscription: WebhookSubscription; secret: string }> {
    // Fails fast here too, not just at actual delivery time (see
    // deliver()'s own comment on why the check lives there as the real
    // enforcement point) - an admin creating a subscription gets
    // immediate feedback instead of a silently-failing subscription
    // they won't notice is broken until the first real event fires.
    await assertPublicUrl(dto.url);
    const secret = randomBytes(24).toString('hex');
    const subscription = await this.subscriptionsRepo.save(
      this.subscriptionsRepo.create({ ...dto, secret }),
    );
    return { subscription, secret };
  }

  async list(): Promise<WebhookSubscription[]> {
    return this.subscriptionsRepo.find({ order: { createdAt: 'DESC' } });
  }

  async setActive(id: string, isActive: boolean): Promise<WebhookSubscription> {
    await this.subscriptionsRepo.update(id, { isActive });
    return this.subscriptionsRepo.findOne({ where: { id } }) as Promise<WebhookSubscription>;
  }

  // secret is deliberately not editable here - not part of
  // UpdateWebhookSubscriptionDto at all. Rotating it would silently
  // break every signature the partner is already verifying against,
  // and this isn't the create flow where a fresh secret is the whole
  // point.
  async update(id: string, dto: UpdateWebhookSubscriptionDto): Promise<WebhookSubscription> {
    const subscription = await this.subscriptionsRepo.findOne({ where: { id } });
    if (!subscription) throw new NotFoundException('Webhook subscription not found');

    if (dto.url !== undefined) {
      await assertPublicUrl(dto.url); // same early-feedback reasoning as subscribe() above
      subscription.url = dto.url;
    }
    if (dto.partnerName !== undefined) subscription.partnerName = dto.partnerName;
    if (dto.events !== undefined) subscription.events = dto.events;

    return this.subscriptionsRepo.save(subscription);
  }

  async getLogs(subscriptionId: string): Promise<WebhookDeliveryLog[]> {
    return this.logsRepo.find({ where: { subscriptionId }, order: { createdAt: 'DESC' }, take: 50 });
  }

  /**
   * Manual, on-demand delivery an admin triggers to verify a partner's
   * endpoint is actually reachable and signature-verifying correctly -
   * distinct from the real domain events dispatch() fans out
   * automatically. 'webhook.test' is intentionally not in WEBHOOK_EVENTS
   * (a partner never subscribes to it - this fires regardless of what
   * they've opted into, since the whole point is testing connectivity,
   * not exercising their event-filtering logic).
   */
  async sendTest(subscriptionId: string): Promise<WebhookDeliveryLog> {
    const subscription = await this.subscriptionsRepo.findOne({ where: { id: subscriptionId } });
    if (!subscription) throw new NotFoundException('Webhook subscription not found');

    return this.deliver(subscription, 'webhook.test', {
      message: 'This is a test webhook delivery from Ryda.',
      sentAt: new Date().toISOString(),
    });
  }

  /**
   * Re-sends the exact same event/payload that failed, as a NEW delivery
   * attempt with its own log entry - not a mutation of the original
   * failed log. Keeping the original failure on record (rather than
   * overwriting it with the retry's outcome) preserves the actual
   * history of what happened and when, which matters for anyone
   * debugging a partner integration issue later.
   */
  async retry(logId: string): Promise<WebhookDeliveryLog> {
    const log = await this.logsRepo.findOne({ where: { id: logId } });
    if (!log) throw new NotFoundException('Webhook delivery log not found');

    const subscription = await this.subscriptionsRepo.findOne({ where: { id: log.subscriptionId } });
    if (!subscription) throw new NotFoundException('The subscription for this delivery log no longer exists');

    return this.deliver(subscription, log.event, log.payload);
  }

  /** Fans an event out to every active subscription that's opted into it. */
  private async dispatch(event: string, payload: Record<string, unknown>): Promise<void> {
    const subscriptions = await this.subscriptionsRepo.find({ where: { isActive: true } });
    const interested = subscriptions.filter((s) => s.events.includes(event));

    await Promise.all(interested.map((sub) => this.deliver(sub, event, payload)));
  }

  private async deliver(
    subscription: WebhookSubscription,
    event: string,
    payload: Record<string, unknown>,
  ): Promise<WebhookDeliveryLog> {
    // assertPublicUrl existed already, fully built and documented, but
    // was never actually called anywhere in this file (or anywhere else
    // in the codebase) - meaning outbound webhook delivery had zero SSRF
    // protection despite a real, working guard sitting right next to it.
    // Checked here, not just at subscribe()/update() time, because
    // that's genuinely where the guarantee needs to hold: right before a
    // request actually leaves this server, for every path that reaches
    // deliver() (the automatic domain-event fan-out, a manual test send,
    // and a retry all go through here). A subscription whose URL fails
    // this check is recorded as a normal failed delivery, not thrown as
    // an uncaught exception - the automatic fan-out in dispatch() awaits
    // several of these in parallel via Promise.all, and one subscription
    // having gone bad shouldn't take the others down with it.
    try {
      await assertPublicUrl(subscription.url);
    } catch (err) {
      return this.logsRepo.save(
        this.logsRepo.create({
          subscriptionId: subscription.id,
          event,
          payload,
          status: WebhookDeliveryStatus.FAILED,
          errorMessage: (err as Error).message,
        }),
      );
    }

    const body = JSON.stringify({ event, data: payload, timestamp: new Date().toISOString() });
    const signature = createHmac('sha256', subscription.secret).update(body).digest('hex');

    try {
      const response = await fetch(subscription.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-ryda-signature': signature,
          'x-ryda-event': event,
        },
        body,
      });

      return this.logsRepo.save(
        this.logsRepo.create({
          subscriptionId: subscription.id,
          event,
          payload,
          status: response.ok ? WebhookDeliveryStatus.SUCCESS : WebhookDeliveryStatus.FAILED,
          responseCode: response.status,
        }),
      );
    } catch (err) {
      this.logger.warn(`Webhook delivery to ${subscription.url} failed: ${(err as Error).message}`);
      return this.logsRepo.save(
        this.logsRepo.create({
          subscriptionId: subscription.id,
          event,
          payload,
          status: WebhookDeliveryStatus.FAILED,
          errorMessage: (err as Error).message,
        }),
      );
    }
  }

  // ---------------------------------------------------------------------
  // Event listeners — same decoupled pattern as Notifications/Tracking.
  // ---------------------------------------------------------------------

  @OnEvent('ride.created')
  onRideCreated(payload: Record<string, unknown>) {
    return this.dispatch('ride.created', payload);
  }

  @OnEvent('ride.accepted')
  onRideAccepted(payload: Record<string, unknown>) {
    return this.dispatch('ride.accepted', payload);
  }

  @OnEvent('ride.started')
  onRideStarted(payload: Record<string, unknown>) {
    return this.dispatch('ride.started', payload);
  }

  @OnEvent('ride.completed')
  onRideCompleted(payload: Record<string, unknown>) {
    return this.dispatch('ride.completed', payload);
  }

  @OnEvent('ride.cancelled')
  onRideCancelled(payload: Record<string, unknown>) {
    return this.dispatch('ride.cancelled', payload);
  }

  @OnEvent('payment.confirmed')
  onPaymentConfirmed(payload: Record<string, unknown>) {
    return this.dispatch('payment.confirmed', payload);
  }

  @OnEvent('payment.failed')
  onPaymentFailed(payload: Record<string, unknown>) {
    return this.dispatch('payment.failed', payload);
  }

  @OnEvent('wallet.updated')
  onWalletUpdated(payload: Record<string, unknown>) {
    return this.dispatch('wallet.updated', payload);
  }

  @OnEvent('driver.online')
  onDriverOnline(payload: Record<string, unknown>) {
    return this.dispatch('driver.online', payload);
  }

  @OnEvent('driver.offline')
  onDriverOffline(payload: Record<string, unknown>) {
    return this.dispatch('driver.offline', payload);
  }

  @OnEvent('promotion.redeemed')
  onPromotionRedeemed(payload: Record<string, unknown>) {
    return this.dispatch('promotion.redeemed', payload);
  }
}
