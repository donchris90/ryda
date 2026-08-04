import { IsArray, IsEnum, IsString } from 'class-validator';
import { DevicePlatform } from '../entities/device-token.entity';
import { NotificationChannel } from '../entities/notification.entity';

export class RegisterDeviceTokenDto {
  @IsString()
  token: string;

  @IsEnum(DevicePlatform)
  platform: DevicePlatform;
}

export class BroadcastDto {
  @IsArray()
  @IsString({ each: true })
  userIds: string[];

  @IsEnum(NotificationChannel)
  channel: NotificationChannel;

  @IsString()
  title: string;

  @IsString()
  body: string;
}
