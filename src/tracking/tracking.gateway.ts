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

interface AuthedSocket extends Socket {
  data: { userId?: string };
}

/**
 * A client connects with a JWT (handshake auth: `{ token }`), then joins a
 * ride-specific room to receive that ride's driver location updates. Only
 * the ride's own passenger or driver can join — verified directly, not
 * just assumed from the JWT being valid.
 */
@Injectable()
@WebSocketGateway({ cors: { origin: '*' }, namespace: '/tracking' })
export class TrackingGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(TrackingGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    @InjectRepository(Ride)
    private readonly ridesRepo: Repository<Ride>,
  ) {}

  handleConnection(client: AuthedSocket) {
    try {
      const token = client.handshake.auth?.token as string | undefined;
      if (!token) throw new Error('No token provided');

      const payload = this.jwtService.verify(token, {
        secret: this.config.get<string>('jwt.accessSecret'),
      });
      client.data.userId = payload.sub;
    } catch {
      this.logger.warn(`Tracking socket ${client.id} rejected — invalid/missing token`);
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
    const isParticipant = ride.passengerId === userId || ride.driverId === userId;
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

  /** Called by LocationService whenever a driver on an active ride reports a new position. */
  broadcastDriverLocation(rideId: string, payload: { lat: number; lng: number; at: Date }): void {
    this.server.to(this.roomFor(rideId)).emit('driver:location', { rideId, ...payload });
  }

  /**
   * ChatService emits this after saving a message — broadcast to the same
   * `ride:${rideId}` room location updates already use, so a chat client
   * only needs the one `subscribe:ride` call to get both location and
   * messages.
   */
  @OnEvent('ride.message.sent')
  broadcastRideMessage(message: { rideId: string; id: string; senderId: string; senderRole: string; message: string; createdAt: Date }): void {
    this.server.to(this.roomFor(message.rideId)).emit('ride:message', message);
  }

  private roomFor(rideId: string): string {
    return `ride:${rideId}`;
  }
}
