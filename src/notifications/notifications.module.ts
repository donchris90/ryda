import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { Notification } from './entities/notification.entity';
import { DeviceToken } from './entities/device-token.entity';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsProcessor } from './processors/notifications.processor';
import { TwilioProvider } from './providers/twilio.provider';
import { SendGridProvider } from './providers/sendgrid.provider';
import { FcmProvider } from './providers/fcm.provider';
import { ExpoPushProvider } from './providers/expo-push.provider';
import { UsersModule } from '../users/users.module';
import { MailerModule } from '../mailer/mailer.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Notification, DeviceToken]),
    UsersModule,
    MailerModule,
    BullModule.registerQueue({ name: 'notifications' }),
  ],
  providers: [NotificationsService, NotificationsProcessor, TwilioProvider, SendGridProvider, FcmProvider, ExpoPushProvider],
  controllers: [NotificationsController],
  exports: [NotificationsService],
})
export class NotificationsModule {}
