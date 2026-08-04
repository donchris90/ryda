import { Module } from '@nestjs/common';
import { StorageService } from './storage.service';
import { StorageController } from './storage.controller';
import { LocalDiskProvider } from './providers/local-disk.provider';
import { S3Provider } from './providers/s3.provider';
import { CloudflareR2Provider } from './providers/cloudflare-r2.provider';

@Module({
  providers: [StorageService, LocalDiskProvider, S3Provider, CloudflareR2Provider],
  controllers: [StorageController],
  exports: [StorageService],
})
export class StorageModule {}
