import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { RideMessage } from './entities/ride-message.entity';
import { Ride } from '../rides/entities/ride.entity';

@Injectable()
export class ChatService {
  constructor(
    @InjectRepository(RideMessage)
    private readonly messagesRepo: Repository<RideMessage>,
    @InjectRepository(Ride)
    private readonly ridesRepo: Repository<Ride>,
    private readonly events: EventEmitter2,
  ) {}

  private async assertParticipant(rideId: string, userId: string): Promise<Ride> {
    const ride = await this.ridesRepo.findOne({ where: { id: rideId } });
    if (!ride) throw new NotFoundException('Ride not found');
    if (ride.passengerId !== userId && ride.driverId !== userId) {
      throw new ForbiddenException("You don't have access to this ride's messages");
    }
    return ride;
  }

  async sendMessage(rideId: string, senderId: string, message: string): Promise<RideMessage> {
    const ride = await this.assertParticipant(rideId, senderId);
    const senderRole: 'passenger' | 'driver' = ride.passengerId === senderId ? 'passenger' : 'driver';

    const saved = await this.messagesRepo.save(
      this.messagesRepo.create({ rideId, senderId, senderRole, message }),
    );

    // Delivered in real time via TrackingGateway, which already owns a
    // `ride:${rideId}` Socket.IO room from the location-tracking feature —
    // reusing it here rather than standing up a second gateway/room
    // scheme just for chat.
    this.events.emit('ride.message.sent', saved);

    return saved;
  }

  /**
   * Same delivery path as sendMessage() (saved + broadcast the same
   * way), but with no real sender — used for call-outcome messages
   * ("Missed call", "Call ended • 2:34") posted by TrackingGateway's
   * call:end handler. senderId has no FK constraint (see
   * CreateRideMessagesTable migration), so the literal string 'system'
   * is a safe, simple sentinel rather than needing a nullable column.
   * No participant check here - the caller (TrackingGateway) already
   * verified both parties are on this ride when it validated the call.
   */
  async postSystemMessage(rideId: string, message: string): Promise<RideMessage> {
    const saved = await this.messagesRepo.save(
      this.messagesRepo.create({ rideId, senderId: 'system', senderRole: 'system', message }),
    );
    this.events.emit('ride.message.sent', saved);
    return saved;
  }

  async getMessages(rideId: string, requesterId: string): Promise<RideMessage[]> {
    await this.assertParticipant(rideId, requesterId);
    return this.messagesRepo.find({ where: { rideId }, order: { createdAt: 'ASC' } });
  }
}
