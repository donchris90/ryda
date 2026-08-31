import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StorageService } from './storage.service';
import { StorageController } from './storage.controller';
import { LocalDiskProvider } from './providers/local-disk.provider';
import { S3Provider } from './providers/s3.provider';
import { CloudflareR2Provider } from './providers/cloudflare-r2.provider';
import { DriverDocument } from '../drivers/entities/driver-document.entity';
import { UploadedFile } from './entities/uploaded-file.entity';
import { Ride } from '../rides/entities/ride.entity';
import { SupportModule } from '../support/support.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([DriverDocument, UploadedFile, Ride]),
    SupportModule,
  ],
  providers: [
    StorageService,
    LocalDiskProvider,
    S3Provider,
    CloudflareR2Provider,
  ],
  controllers: [StorageController],
  exports: [StorageService],
})
export class StorageModule {}
