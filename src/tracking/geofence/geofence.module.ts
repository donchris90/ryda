import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Geofence } from './entities/geofence.entity';
import { GeofenceEvent } from './entities/geofence-event.entity';
import { GeofenceService } from './geofence.service';
import { GeofenceController } from './geofence.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Geofence, GeofenceEvent])],
  providers: [GeofenceService],
  controllers: [GeofenceController],
  exports: [GeofenceService],
})
export class GeofenceModule {}
