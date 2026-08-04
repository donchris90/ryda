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

  async getMessages(rideId: string, requesterId: string): Promise<RideMessage[]> {
    await this.assertParticipant(rideId, requesterId);
    return this.messagesRepo.find({ where: { rideId }, order: { createdAt: 'ASC' } });
  }
}
