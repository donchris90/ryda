import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApiKey } from './entities/api-key.entity';
import { Ride } from '../rides/entities/ride.entity';
import { ApiKeysService } from './api-keys.service';
import { ApiKeysController, PartnerController } from './api-keys.controller';
import { ApiKeyGuard } from './api-key.guard';

@Module({
  imports: [TypeOrmModule.forFeature([ApiKey, Ride])],
  providers: [ApiKeysService, ApiKeyGuard],
  controllers: [ApiKeysController, PartnerController],
  exports: [ApiKeysService],
})
export class ApiKeysModule {}
