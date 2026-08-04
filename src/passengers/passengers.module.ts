import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PassengerProfile } from './entities/passenger-profile.entity';
import { FavouritePlace } from './entities/favourite-place.entity';
import { EmergencyContact } from './entities/emergency-contact.entity';
import { PassengersService } from './passengers.service';
import { PassengersController } from './passengers.controller';

@Module({
  imports: [TypeOrmModule.forFeature([PassengerProfile, FavouritePlace, EmergencyContact])],
  providers: [PassengersService],
  controllers: [PassengersController],
  exports: [PassengersService],
})
export class PassengersModule {}
