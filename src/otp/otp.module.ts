import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OtpCode } from './otp-code.entity';
import { OtpService } from './otp.service';
import { TwilioProvider } from '../notifications/providers/twilio.provider';

@Module({
  imports: [TypeOrmModule.forFeature([OtpCode])],
  providers: [OtpService, TwilioProvider],
  exports: [OtpService],
})
export class OtpModule {}
