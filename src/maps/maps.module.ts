import { Module } from '@nestjs/common';
import { GoogleMapsService } from './google-maps.service';
import { NominatimService } from './nominatim.service';
import { MapsController } from './maps.controller';

@Module({
  providers: [GoogleMapsService, NominatimService],
  controllers: [MapsController],
  exports: [GoogleMapsService],
})
export class MapsModule {}
