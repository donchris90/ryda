import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserDevice } from './entities/user-device.entity';
import { FraudFlag } from './entities/fraud-flag.entity';
import { FraudService } from './fraud.service';
import { FraudController } from './fraud.controller';

@Module({
  imports: [TypeOrmModule.forFeature([UserDevice, FraudFlag])],
  providers: [FraudService],
  controllers: [FraudController],
  exports: [FraudService],
})
export class FraudModule {}
