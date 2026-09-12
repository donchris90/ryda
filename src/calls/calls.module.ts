import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Ride } from '../rides/entities/ride.entity';
import { UsersModule } from '../users/users.module';
import { CallLog } from './entities/call-log.entity';
import { CallsService } from './calls.service';
import { CallsController } from './calls.controller';
import { AfricasTalkingVoiceProvider } from '../notifications/providers/africas-talking-voice.provider';

@Module({
  imports: [TypeOrmModule.forFeature([Ride, CallLog]), UsersModule],
  providers: [CallsService, AfricasTalkingVoiceProvider],
  controllers: [CallsController],
  exports: [CallsService],
})
export class CallsModule {}
