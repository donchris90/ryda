import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RideMessage } from './entities/ride-message.entity';
import { Ride } from '../rides/entities/ride.entity';
import { ChatService } from './chat.service';
import { ChatController } from './chat.controller';

@Module({
  imports: [TypeOrmModule.forFeature([RideMessage, Ride])],
  providers: [ChatService],
  controllers: [ChatController],
})
export class ChatModule {}
