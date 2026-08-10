import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Notification, NotificationChannel, NotificationCategory, NotificationStatus } from './entities/notification.entity';
import { DeviceToken, DevicePlatform } from './entities/device-token.entity';
import { TwilioProvider } from './providers/twilio.provider';
import { SendGridProvider } from './providers/sendgrid.provider';
import { FcmProvider } from './providers/fcm.provider';
import { ExpoPushProvider } from './providers/expo-push.provider';
import { UsersService } from '../users/users.service';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectRepository(Notification)
    private readonly notificationsRepo: Repository<Notification>,
    @InjectRepository(DeviceToken)
    private readonly deviceTokensRepo: Repository<DeviceToken>,
    private readonly twilio: TwilioProvider,
    private readonly sendgrid: SendGridProvider,
    private readonly fcm: FcmProvider,
    private readonly expoPush: ExpoPushProvider,
    private readonly usersService: UsersService,
    @InjectQueue('notifications') private readonly notificationsQueue: Queue,
  ) {}

  // ---- Device tokens (for push) ----

  async registerDeviceToken(userId: string, token: string, platform: DevicePlatform): Promise<DeviceToken> {
    const existing = await this.deviceTokensRepo.findOne({ where: { token } });
    if (existing) {
      existing.userId = userId;
      existing.platform = platform;
      return this.deviceTokensRepo.save(existing);
    }
    return this.deviceTokensRepo.save(this.deviceTokensRepo.create({ userId, token, platform }));
  }

  async removeDeviceToken(userId: string, token: string): Promise<{ removed: boolean }> {
    const result = await this.deviceTokensRepo.delete({ userId, token });
    return { removed: (result.affected ?? 0) > 0 };
  }

  // ---- Per-channel sends ----

  async sendSms(userId: string, phone: string, title: string, body: string, category?: NotificationCategory): Promise<Notification> {
    const record = await this.createRecord(userId, NotificationChannel.SMS, title, body, undefined, category);
    if (!this.twilio.isSmsConfigured()) return this.markSimulated(record);

    const result = await this.twilio.sendSms(phone, body);
    return this.applyResult(record, result);
  }

  async sendWhatsapp(userId: string, phone: string, title: string, body: string, category?: NotificationCategory): Promise<Notification> {
    const record = await this.createRecord(userId, NotificationChannel.WHATSAPP, title, body, undefined, category);
    if (!this.twilio.isWhatsappConfigured()) return this.markSimulated(record);

    const result = await this.twilio.sendWhatsapp(phone, body);
    return this.applyResult(record, result);
  }

  async sendEmail(userId: string, email: string, subject: string, body: string, category?: NotificationCategory): Promise<Notification> {
    const record = await this.createRecord(userId, NotificationChannel.EMAIL, subject, body, undefined, category);
    if (!this.sendgrid.isConfigured()) return this.markSimulated(record);

    const result = await this.sendgrid.sendEmail(email, subject, body);
    return this.applyResult(record, result);
  }

  /** Sends to every device registered for this user. Records one Notification row regardless of device count. */
  async sendPush(userId: string, title: string, body: string, data?: Record<string, string>, category?: NotificationCategory): Promise<Notification> {
    const record = await this.createRecord(userId, NotificationChannel.PUSH, title, body, data, category);

    const devices = await this.deviceTokensRepo.find({ where: { userId } });
    if (devices.length === 0) {
      return this.applyResult(record, { success: false, error: 'No registered device tokens' });
    }

    // Per-device routing, not a single global provider choice — an Expo
    // push token (what expo-notifications' getExpoPushTokenAsync()
    // produces, and the only kind this project's own apps register) goes
    // to Expo's push service; anything else falls back to raw FCM if
    // that's configured. See ExpoPushProvider's own comment for why this
    // split exists.
    const results = await Promise.all(
      devices.map((d) => {
        if (this.expoPush.isExpoPushToken(d.token)) {
          return this.expoPush.sendPush(d.token, title, body, data);
        }
        if (this.fcm.isConfigured()) {
          return this.fcm.sendPush(d.token, title, body, data);
        }
        return Promise.resolve({ success: false, error: 'Token format not recognized and FCM not configured' });
      }),
    );
    const anySucceeded = results.some((r) => r.success);
    return this.applyResult(
      record,
      anySucceeded
        ? { success: true }
        : { success: false, error: results[0]?.error ?? 'All device sends failed' },
    );
  }

  async sendInApp(userId: string, title: string, body: string, metadata?: Record<string, unknown>, category?: NotificationCategory): Promise<Notification> {
    const record = await this.createRecord(userId, NotificationChannel.IN_APP, title, body, metadata, category);
    record.status = NotificationStatus.SENT; // in-app "delivery" is just the DB write itself
    return this.notificationsRepo.save(record);
  }

  /** Fans a message out across whichever channels are requested, looking up phone/email as needed. */
  async notify(
    userId: string,
    channels: NotificationChannel[],
    title: string,
    body: string,
    metadata?: Record<string, unknown>,
    category?: NotificationCategory,
  ): Promise<void> {
    const user = await this.usersService.findById(userId);

    await Promise.all(
      channels.map(async (channel) => {
        switch (channel) {
          case NotificationChannel.IN_APP:
            return this.sendInApp(userId, title, body, metadata, category);
          case NotificationChannel.SMS:
            return this.sendSms(userId, user.phone, title, body, category);
          case NotificationChannel.WHATSAPP:
            return this.sendWhatsapp(userId, user.phone, title, body, category);
          case NotificationChannel.EMAIL:
            return user.email ? this.sendEmail(userId, user.email, title, body, category) : undefined;
          case NotificationChannel.PUSH:
            return this.sendPush(userId, title, body, metadata as Record<string, string> | undefined, category);
        }
      }),
    );
  }

  // ---- History / read state ----

  async listForUser(userId: string, limit = 50): Promise<Notification[]> {
    return this.notificationsRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  async unreadCount(userId: string): Promise<number> {
    return this.notificationsRepo.count({ where: { userId, isRead: false } });
  }

  async markRead(userId: string, id: string): Promise<Notification> {
    const record = await this.notificationsRepo.findOne({ where: { id, userId } });
    if (!record) throw new NotFoundException('Notification not found');
    record.isRead = true;
    return this.notificationsRepo.save(record);
  }

  async markAllRead(userId: string): Promise<{ updated: number }> {
    const result = await this.notificationsRepo.update({ userId, isRead: false }, { isRead: true });
    return { updated: result.affected ?? 0 };
  }

  // ---- Internals ----

  private async createRecord(
    userId: string,
    channel: NotificationChannel,
    title: string,
    body: string,
    metadata?: Record<string, unknown>,
    category: NotificationCategory = NotificationCategory.GENERAL,
  ): Promise<Notification> {
    return this.notificationsRepo.save(
      this.notificationsRepo.create({ userId, channel, category, title, body, metadata: metadata ?? null }),
    );
  }

  private async markSimulated(record: Notification): Promise<Notification> {
    record.status = NotificationStatus.SIMULATED;
    return this.notificationsRepo.save(record);
  }

  private async applyResult(
    record: Notification,
    result: { success: boolean; error?: string },
  ): Promise<Notification> {
    record.status = result.success ? NotificationStatus.SENT : NotificationStatus.FAILED;
    if (!result.success) record.failureReason = result.error ?? 'Unknown error';
    return this.notificationsRepo.save(record);
  }

  // -----------------------------------------------------------------------
  // Event listeners — decoupled from RidesService/DriversService/etc via
  // @nestjs/event-emitter, same pattern as PaymentsService's payment.confirmed.
  // -----------------------------------------------------------------------

  @OnEvent('ride.accepted')
  async onRideAccepted(payload: { passengerId: string; driverName: string }) {
    await this.safeNotify(
      payload.passengerId,
      [NotificationChannel.IN_APP, NotificationChannel.PUSH],
      'Driver on the way',
      `${payload.driverName} accepted your ride and is heading your way.`,
      undefined,
      NotificationCategory.RIDE,
    );
  }

  @OnEvent('ride.arrived')
  async onRideArrived(payload: { passengerId: string }) {
    await this.safeNotify(
      payload.passengerId,
      [NotificationChannel.IN_APP, NotificationChannel.PUSH],
      'Your driver has arrived',
      "Your driver is waiting at the pickup point.",
      undefined,
      NotificationCategory.RIDE,
    );
  }

  @OnEvent('ride.started')
  async onRideStarted(payload: { passengerId: string }) {
    await this.safeNotify(
      payload.passengerId,
      [NotificationChannel.IN_APP, NotificationChannel.PUSH],
      'Trip started',
      "You're on your way — have a safe trip.",
      undefined,
      NotificationCategory.RIDE,
    );
  }

  @OnEvent('ride.offered')
  async onRideOffered(payload: {
    driverUserId: string;
    rideId: string;
    pickupAddress: string;
    distanceKm: number;
    timeoutSeconds: number;
  }) {
    await this.safeNotify(
      payload.driverUserId,
      [NotificationChannel.PUSH, NotificationChannel.IN_APP],
      'New ride nearby!',
      `Pickup at ${payload.pickupAddress} (${payload.distanceKm}km away). Respond within ${payload.timeoutSeconds}s.`,
      { rideId: payload.rideId, type: 'ride_offer' },
      NotificationCategory.RIDE,
    );
  }

  @OnEvent('ride.completed')
  async onRideCompleted(payload: { passengerId: string; driverId: string; totalFare: string }) {
    await Promise.all([
      this.safeNotify(
        payload.passengerId,
        [NotificationChannel.IN_APP, NotificationChannel.PUSH],
        'Trip completed',
        `Your trip is complete. Total fare: ${payload.totalFare}.`,
        undefined,
        NotificationCategory.RIDE,
      ),
      this.safeNotify(
        payload.driverId,
        [NotificationChannel.IN_APP, NotificationChannel.PUSH],
        'Trip completed',
        `Trip completed. Check your wallet for earnings.`,
        undefined,
        NotificationCategory.RIDE,
      ),
    ]);
  }

  @OnEvent('ride.cancelled')
  async onRideCancelled(payload: { notifyUserId: string; reason: string | null }) {
    await this.safeNotify(
      payload.notifyUserId,
      [NotificationChannel.IN_APP, NotificationChannel.PUSH],
      'Ride cancelled',
      payload.reason ? `Your ride was cancelled: ${payload.reason}` : 'Your ride was cancelled.',
      undefined,
      NotificationCategory.RIDE,
    );
  }

  @OnEvent('driver.approval.changed')
  async onDriverApprovalChanged(payload: { userId: string; approved: boolean }) {
    await this.safeNotify(
      payload.userId,
      [NotificationChannel.IN_APP, NotificationChannel.SMS, NotificationChannel.PUSH],
      payload.approved ? 'You are approved to drive' : 'Application update',
      payload.approved
        ? 'Congratulations — your driver application was approved. You can go online now.'
        : 'There was an update to your driver application. Please check the app for details.',
      undefined,
      NotificationCategory.SECURITY,
    );
  }

  @OnEvent('driver.document.expiring')
  async onDriverDocumentExpiring(payload: { userId: string; documentType: string; daysLeft: number }) {
    const label = payload.documentType.replace(/_/g, ' ');
    await this.safeNotify(
      payload.userId,
      [NotificationChannel.IN_APP, NotificationChannel.PUSH],
      'Document expiring soon',
      `Your ${label} expires in ${payload.daysLeft} day${payload.daysLeft === 1 ? '' : 's'} — renew it to keep driving without interruption.`,
      undefined,
      NotificationCategory.SECURITY,
    );
  }

  @OnEvent('referral.bonus_granted')
  async onReferralBonusGranted(payload: { userId: string; amount: string }) {
    await this.safeNotify(
      payload.userId,
      [NotificationChannel.IN_APP, NotificationChannel.PUSH],
      'Referral bonus credited',
      `₦${payload.amount} referral bonus has been added to your wallet.`,
      undefined,
      NotificationCategory.WALLET,
    );
  }

  @OnEvent('payment.failed')
  async onPaymentFailed(payload: { userId: string; reason: string }) {
    await this.safeNotify(
      payload.userId,
      [NotificationChannel.IN_APP, NotificationChannel.SMS],
      'Payment failed',
      `We couldn't process your payment: ${payload.reason}`,
      undefined,
      NotificationCategory.WALLET,
    );
  }

  @OnEvent('delivery.requested')
  async onDeliveryRequested(payload: { driverUserIds: string[]; deliveryId: string; pickupAddress: string }) {
    await Promise.all(
      payload.driverUserIds.map((driverUserId) =>
        this.safeNotify(
          driverUserId,
          [NotificationChannel.PUSH, NotificationChannel.IN_APP],
          'New delivery nearby!',
          `Pickup at ${payload.pickupAddress}.`,
          { deliveryId: payload.deliveryId, type: 'delivery_request' },
          NotificationCategory.RIDE,
        ),
      ),
    );
  }

  @OnEvent('delivery.delivered')
  async onDeliveryDelivered(payload: { customerId: string; driverId: string; totalFare: string }) {
    await Promise.all([
      this.safeNotify(
        payload.customerId,
        [NotificationChannel.IN_APP, NotificationChannel.PUSH],
        'Delivery completed',
        `Your delivery has arrived. Total: ${payload.totalFare}.`,
        undefined,
        NotificationCategory.RIDE,
      ),
      this.safeNotify(
        payload.driverId,
        [NotificationChannel.IN_APP, NotificationChannel.PUSH],
        'Delivery completed',
        'Delivery completed. Check your wallet for earnings.',
        undefined,
        NotificationCategory.RIDE,
      ),
    ]);
  }

  @OnEvent('delivery.cancelled')
  async onDeliveryCancelled(payload: { notifyUserId: string; reason: string | null }) {
    await this.safeNotify(
      payload.notifyUserId,
      [NotificationChannel.IN_APP, NotificationChannel.PUSH],
      'Delivery cancelled',
      payload.reason ? `Delivery cancelled: ${payload.reason}` : 'Delivery cancelled.',
      undefined,
      NotificationCategory.RIDE,
    );
  }

  @OnEvent('support.ticket.created')
  async onTicketCreated(payload: { userId: string; ticketId: string; subject: string }) {
    await this.safeNotify(
      payload.userId,
      [NotificationChannel.IN_APP],
      'Support ticket received',
      `We've received your ticket "${payload.subject}" and will get back to you soon.`,
      undefined,
      NotificationCategory.SUPPORT,
    );
  }

  @OnEvent('support.ticket.status_changed')
  async onTicketStatusChanged(payload: { userId: string; ticketId: string; status: string }) {
    await this.safeNotify(
      payload.userId,
      [NotificationChannel.IN_APP, NotificationChannel.PUSH],
      'Support ticket update',
      `Your support ticket status changed to: ${payload.status}.`,
      undefined,
      NotificationCategory.SUPPORT,
    );
  }

  @OnEvent('incident.sos_triggered')
  async onSosTriggered(payload: { incidentId: string; userId: string; emergencyContactPhones: string[] }) {
    // Confirms receipt to the reporter. Escalating to on-call admin/support
    // staff and actually SMS-ing the reporter's emergency contacts (whose
    // phone numbers aren't tied to a User account, so they can't go through
    // the normal userId-keyed Notification model) is a real gap — see
    // README. The Incident row itself is real and immediately visible on
    // GET /admin/emergency/incidents/active for a human to act on.
    await this.safeNotify(
      payload.userId,
      [NotificationChannel.IN_APP, NotificationChannel.PUSH, NotificationChannel.SMS],
      'SOS received',
      'Your emergency alert has been received. Help is being notified.',
      undefined,
      NotificationCategory.SECURITY,
    );
  }

  @OnEvent('incentive.rewarded')
  async onIncentiveRewarded(payload: { driverUserId: string; incentiveName: string; amount: string }) {
    await this.safeNotify(
      payload.driverUserId,
      [NotificationChannel.IN_APP, NotificationChannel.PUSH],
      'Bonus earned!',
      `You earned ₦${payload.amount} for: ${payload.incentiveName}`,
      undefined,
      NotificationCategory.WALLET,
    );
  }

  @OnEvent('geofence.entered')
  async onGeofenceEntered(payload: { driverUserId: string; geofenceName: string; geofenceType: string }) {
    if (payload.geofenceType !== 'restricted') return; // alert_zone entries are for admin monitoring only, not a driver-facing warning
    await this.safeNotify(
      payload.driverUserId,
      [NotificationChannel.IN_APP],
      'Restricted area',
      `You've entered a restricted zone: ${payload.geofenceName}.`,
      undefined,
      NotificationCategory.SECURITY,
    );
  }

  /**
   * Event listeners enqueue rather than send synchronously — actual
   * delivery (and the failure handling that used to live in a try/catch
   * here) now happens in NotificationsProcessor, off the request/event path.
   */
  private async safeNotify(
    userId: string,
    channels: NotificationChannel[],
    title: string,
    body: string,
    metadata?: Record<string, unknown>,
    category?: NotificationCategory,
  ): Promise<void> {
    await this.notificationsQueue.add(
      'send',
      { userId, channels, title, body, metadata, category },
      { attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
    );
  }
}
