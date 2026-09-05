import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OtpCode } from './otp-code.entity';
import { OtpService } from './otp.service';
import { AfricasTalkingProvider } from './providers/africas-talking.provider';

@Module({
  imports: [TypeOrmModule.forFeature([OtpCode])],
  providers: [OtpService, AfricasTalkingProvider],
  exports: [OtpService],
})
export class OtpModule {}
