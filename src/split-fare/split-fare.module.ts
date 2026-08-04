import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SplitFareRequest } from './entities/split-fare-request.entity';
import { SplitFareParticipant } from './entities/split-fare-participant.entity';
import { Ride } from '../rides/entities/ride.entity';
import { SplitFareService } from './split-fare.service';
import { SplitFareController } from './split-fare.controller';
import { UsersModule } from '../users/users.module';
import { WalletsModule } from '../wallets/wallets.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([SplitFareRequest, SplitFareParticipant, Ride]),
    UsersModule,
    WalletsModule,
  ],
  providers: [SplitFareService],
  controllers: [SplitFareController],
})
export class SplitFareModule {}
