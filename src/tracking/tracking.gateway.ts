import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Ride } from '../rides/entities/ride.entity';
import { DeliveryOrder } from '../logistics/entities/delivery-order.entity';
import { SupportTicket } from '../support/entities/support-ticket.entity';
import { SUPPORT_STAFF_ROLES } from '../support/support.service';
import { UserRole } from '../common/enums/user-role.enum';
import { ADMIN_LIKE_ROLES } from '../common/enums/user-role.enum';

const ADMIN_LIKE_SOCKET_ROLES = [...ADMIN_LIKE_ROLES, UserRole.DISPATCHER];

interface AuthedSocket extends Socket {
  data: { userId?: string; role?: string };
}

/**
 * A client connects with a JWT (handshake auth: `{ token }`), then joins a
 * ride-specific room to receive that ride's driver location updates. Only
 * the ride's own passenger or driver can join — verified directly, not
 * just assumed from the JWT being valid.
 */
@Injectable()
@WebSocketGateway({ cors: { origin: '*' }, namespace: '/tracking' })
export class TrackingGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(TrackingGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    @InjectRepository(Ride)
    private readonly ridesRepo: Repository<Ride>,
    @InjectRepository(DeliveryOrder)
    private readonly deliveryOrdersRepo: Repository<DeliveryOrder>,
    @InjectRepository(SupportTicket)
    private readonly ticketsRepo: Repository<SupportTicket>,
  ) {}

  handleConnection(client: AuthedSocket) {
    try {
      const token = client.handshake.auth?.token as string | undefined;
      if (!token) throw new Error('No token provided');

      const payload = this.jwtService.verify(token, {
        secret: this.config.get<string>('jwt.accessSecret'),
      });
      client.data.userId = payload.sub;
      client.data.role = payload.role;
    } catch {
      this.logger.warn(
        `Tracking socket ${client.id} rejected — invalid/missing token`,
      );
      client.disconnect(true);
    }
  }

  handleDisconnect(client: AuthedSocket) {
    this.logger.debug(`Tracking socket disconnected: ${client.id}`);
  }

  @SubscribeMessage('subscribe:ride')
  async handleSubscribeRide(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() data: { rideId: string },
  ) {
    const ride = await this.ridesRepo.findOne({ where: { id: data.rideId } });
    if (!ride) return { error: 'Ride not found' };

    const userId = client.data.userId;
    const isParticipant =
      ride.passengerId === userId || ride.driverId === userId;
    if (!isParticipant) return { error: 'Not a participant in this ride' };

    await client.join(this.roomFor(data.rideId));
    return { subscribed: true, rideId: data.rideId };
  }

  @SubscribeMessage('unsubscribe:ride')
  async handleUnsubscribeRide(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() data: { rideId: string },
  ) {
    await client.leave(this.roomFor(data.rideId));
    return { unsubscribed: true, rideId: data.rideId };
  }

  /**
   * Deliveries never had this at all — only rides did, meaning the
   * delivery tracking screen could only poll for status, with no live
   * driver location the way ride tracking has had all along. Mirrors
   * subscribe:ride exactly, including real ownership verification
   * (the delivery's own customer or driver, not just any authenticated
   * user), rather than assume parity without checking.
   */
  @SubscribeMessage('subscribe:delivery')
  async handleSubscribeDelivery(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() data: { deliveryId: string },
  ) {
    const delivery = await this.deliveryOrdersRepo.findOne({
      where: { id: data.deliveryId },
    });
    if (!delivery) return { error: 'Delivery not found' };

    const userId = client.data.userId;
    const isParticipant =
      delivery.customerId === userId || delivery.driverId === userId;
    if (!isParticipant) return { error: 'Not a participant in this delivery' };

    await client.join(this.roomForDelivery(data.deliveryId));
    return { subscribed: true, deliveryId: data.deliveryId };
  }

  @SubscribeMessage('unsubscribe:delivery')
  async handleUnsubscribeDelivery(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() data: { deliveryId: string },
  ) {
    await client.leave(this.roomForDelivery(data.deliveryId));
    return { unsubscribed: true, deliveryId: data.deliveryId };
  }

  /**
   * Admin-only room that receives every driver location update as it
   * happens, regardless of which ride (if any) that driver is on — the
   * per-ride rooms above intentionally scope to one ride at a time, which
   * is right for a passenger/driver but wouldn't let the admin dashboard's
   * live map see the whole fleet move at once.
   */
  @SubscribeMessage('subscribe:admin-live')
  async handleSubscribeAdminLive(@ConnectedSocket() client: AuthedSocket) {
    if (!ADMIN_LIKE_SOCKET_ROLES.includes(client.data.role as UserRole)) {
      return { error: 'Not authorized' };
    }
    await client.join(this.adminLiveRoom());
    return { subscribed: true };
  }

  @SubscribeMessage('unsubscribe:admin-live')
  async handleUnsubscribeAdminLive(@ConnectedSocket() client: AuthedSocket) {
    await client.leave(this.adminLiveRoom());
    return { unsubscribed: true };
  }

  /** Called by LocationService on every driver location update, ride or no ride. */
  broadcastAdminDriverLocation(payload: {
    driverId: string;
    lat: number;
    lng: number;
    at: Date;
    rideId?: string | null;
  }): void {
    this.server.to(this.adminLiveRoom()).emit('admin:driver-location', payload);
  }

  private adminLiveRoom(): string {
    return 'admin:live';
  }

  @SubscribeMessage('subscribe:ticket')
  async handleSubscribeTicket(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() data: { ticketId: string },
  ) {
    const ticket = await this.ticketsRepo.findOne({
      where: { id: data.ticketId },
    });
    if (!ticket) return { error: 'Ticket not found' };

    const userId = client.data.userId;
    const isOwner = ticket.userId === userId;
    const isStaff = SUPPORT_STAFF_ROLES.includes(client.data.role as UserRole);
    if (!isOwner && !isStaff)
      return { error: 'Not authorized for this ticket' };

    await client.join(this.roomForTicket(data.ticketId));
    return { subscribed: true, ticketId: data.ticketId };
  }

  @SubscribeMessage('unsubscribe:ticket')
  async handleUnsubscribeTicket(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() data: { ticketId: string },
  ) {
    await client.leave(this.roomForTicket(data.ticketId));
    return { unsubscribed: true, ticketId: data.ticketId };
  }

  /** Called by LocationService whenever a driver on an active ride reports a new position. */
  broadcastDriverLocation(
    rideId: string,
    payload: { lat: number; lng: number; at: Date },
  ): void {
    this.server
      .to(this.roomFor(rideId))
      .emit('driver:location', { rideId, ...payload });
  }

  /** Same as broadcastDriverLocation, for a driver currently handling an active delivery. */
  broadcastDeliveryLocation(
    deliveryId: string,
    payload: { lat: number; lng: number; at: Date },
  ): void {
    this.server
      .to(this.roomForDelivery(deliveryId))
      .emit('driver:location', { deliveryId, ...payload });
  }

  /**
   * ChatService emits this after saving a message — broadcast to the same
   * `ride:${rideId}` room location updates already use, so a chat client
   * only needs the one `subscribe:ride` call to get both location and
   * messages.
   */
  @OnEvent('ride.message.sent')
  broadcastRideMessage(message: {
    rideId: string;
    id: string;
    senderId: string;
    senderRole: string;
    message: string;
    createdAt: Date;
  }): void {
    this.server.to(this.roomFor(message.rideId)).emit('ride:message', message);
  }

  private roomFor(rideId: string): string {
    return `ride:${rideId}`;
  }

  private roomForDelivery(deliveryId: string): string {
    return `delivery:${deliveryId}`;
  }

  private roomForTicket(ticketId: string): string {
    return `ticket:${ticketId}`;
  }

  /** SupportService emits this after saving a message — see addMessage(). */
  @OnEvent('support.message.sent')
  broadcastTicketMessage(message: {
    ticketId: string;
    id: string;
    senderId: string;
    senderRole: string;
    message: string;
    createdAt: Date;
  }): void {
    this.server
      .to(this.roomForTicket(message.ticketId))
      .emit('ticket:message', message);
  }
}
