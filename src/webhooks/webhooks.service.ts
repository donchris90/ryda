import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes, createHmac } from 'crypto';
import { OnEvent } from '@nestjs/event-emitter';
import { WebhookSubscription } from './entities/webhook-subscription.entity';
import {
  WebhookDeliveryLog,
  WebhookDeliveryStatus,
} from './entities/webhook-delivery-log.entity';
import { CreateWebhookSubscriptionDto } from './dto/webhook.dto';
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

  async subscribe(
    dto: CreateWebhookSubscriptionDto,
  ): Promise<{ subscription: WebhookSubscription; secret: string }> {
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
    return this.subscriptionsRepo.findOne({
      where: { id },
    }) as Promise<WebhookSubscription>;
  }

  /** Partner name, URL, and event selection are all editable post-creation — only the signing secret is fixed for a subscription's lifetime. */
  async update(
    id: string,
    dto: { partnerName?: string; url?: string; events?: string[] },
  ): Promise<WebhookSubscription> {
    const subscription = await this.subscriptionsRepo.findOne({ where: { id } });
    if (!subscription) throw new NotFoundException('Webhook subscription not found');

    if (dto.url && dto.url !== subscription.url) {
      await assertPublicUrl(dto.url);
      subscription.url = dto.url;
    }
    if (dto.partnerName) subscription.partnerName = dto.partnerName;
    if (dto.events) subscription.events = dto.events;

    return this.subscriptionsRepo.save(subscription);
  }

  /**
   * Sends a synthetic event to the subscription's real URL right now, so an
   * admin can confirm a partner's endpoint is actually reachable and
   * correctly verifying the HMAC signature before relying on it for live
   * traffic. Reuses `deliver()` — this is not a separate delivery path,
   * just a manually-triggered one, and it's logged exactly like a real
   * delivery so it shows up in the subscription's history.
   */
  async sendTestEvent(id: string): Promise<WebhookDeliveryLog> {
    const subscription = await this.subscriptionsRepo.findOne({ where: { id } });
    if (!subscription) throw new NotFoundException('Webhook subscription not found');

    await this.deliver(subscription, 'webhook.test', {
      message: 'This is a test delivery triggered from the Ryda admin dashboard.',
      triggeredAt: new Date().toISOString(),
    });

    const [latest] = await this.logsRepo.find({
      where: { subscriptionId: id, event: 'webhook.test' },
      order: { createdAt: 'DESC' },
      take: 1,
    });
    return latest;
  }

  /** Re-sends the exact event/payload from a previously failed (or successful) delivery log, e.g. after a partner fixes their endpoint. */
  async retryDelivery(logId: string): Promise<WebhookDeliveryLog> {
    const log = await this.logsRepo.findOne({ where: { id: logId } });
    if (!log) throw new NotFoundException('Delivery log not found');

    const subscription = await this.subscriptionsRepo.findOne({ where: { id: log.subscriptionId } });
    if (!subscription) throw new NotFoundException('Webhook subscription not found');

    await this.deliver(subscription, log.event, log.payload);

    const [latest] = await this.logsRepo.find({
      where: { subscriptionId: subscription.id, event: log.event },
      order: { createdAt: 'DESC' },
      take: 1,
    });
    return latest;
  }

  async getLogs(subscriptionId: string): Promise<WebhookDeliveryLog[]> {
    return this.logsRepo.find({
      where: { subscriptionId },
      order: { createdAt: 'DESC' },
      take: 50,
    });
  }

  /** Fans an event out to every active subscription that's opted into it. */
  private async dispatch(
    event: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const subscriptions = await this.subscriptionsRepo.find({
      where: { isActive: true },
    });
    const interested = subscriptions.filter((s) => s.events.includes(event));

    await Promise.all(
      interested.map((sub) => this.deliver(sub, event, payload)),
    );
  }

  private async deliver(
    subscription: WebhookSubscription,
    event: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const body = JSON.stringify({
      event,
      data: payload,
      timestamp: new Date().toISOString(),
    });
    const signature = createHmac('sha256', subscription.secret)
      .update(body)
      .digest('hex');

    try {
      // Re-checked here, not just at subscribe() time: a subscription's URL
      // was validated once when it was created, but this is the actual
      // point requests leave the server, and it's the one that matters.
      await assertPublicUrl(subscription.url);
      const response = await fetch(subscription.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-ryda-signature': signature,
          'x-ryda-event': event,
        },
        body,
      });

      await this.logsRepo.save(
        this.logsRepo.create({
          subscriptionId: subscription.id,
          event,
          payload,
          status: response.ok
            ? WebhookDeliveryStatus.SUCCESS
            : WebhookDeliveryStatus.FAILED,
          responseCode: response.status,
        }),
      );
    } catch (err) {
      this.logger.warn(
        `Webhook delivery to ${subscription.url} failed: ${(err as Error).message}`,
      );
      await this.logsRepo.save(
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
