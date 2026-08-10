import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { LocationHistory } from './entities/location-history.entity';
import { Ride } from '../rides/entities/ride.entity';
import { SupportTicket } from '../support/entities/support-ticket.entity';
import { DeliveryOrder } from '../logistics/entities/delivery-order.entity';
import { TrackingGateway } from './tracking.gateway';
import { LocationService } from './location.service';
import { HistoryService } from './history.service';
import { TrackingController } from './tracking.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([LocationHistory, Ride, SupportTicket, DeliveryOrder]),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('jwt.accessSecret'),
      }),
    }),
  ],
  providers: [TrackingGateway, LocationService, HistoryService],
  controllers: [TrackingController],
  exports: [HistoryService],
})
export class TrackingModule {}
