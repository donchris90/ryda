import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { LocalDiskProvider } from './providers/local-disk.provider';
import { S3Provider } from './providers/s3.provider';
import { CloudflareR2Provider } from './providers/cloudflare-r2.provider';

export interface UploadedFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
}

@Injectable()
export class StorageService {
  private readonly driver: string;

  constructor(
    private readonly config: ConfigService,
    private readonly localDisk: LocalDiskProvider,
    private readonly s3: S3Provider,
    private readonly r2: CloudflareR2Provider,
  ) {
    this.driver = this.config.get<string>('storage.driver')!;
  }

  /** Which folders this backs, per the original spec: driver documents, vehicle photos, chat attachments, support evidence, profile photos. */
  async upload(file: UploadedFile, folder: string): Promise<{ url: string; key: string }> {
    const extension = file.originalname.includes('.') ? file.originalname.split('.').pop() : 'bin';
    const key = `${folder}/${randomUUID()}.${extension}`;

    if (this.driver === 's3' && this.s3.isConfigured()) {
      return { url: await this.s3.upload(file.buffer, key, file.mimetype), key };
    }
    if (this.driver === 'r2' && this.r2.isConfigured()) {
      return { url: await this.r2.upload(file.buffer, key, file.mimetype), key };
    }

    // Falls back to local disk if the configured cloud driver isn't actually
    // configured yet — same "don't break dev/test without real credentials"
    // pattern as Paystack/Maps/notification providers.
    return { url: await this.localDisk.upload(file.buffer, key), key };
  }

  async readLocal(key: string): Promise<Buffer> {
    return this.localDisk.read(key);
  }

  async delete(key: string): Promise<void> {
    if (this.driver === 's3' && this.s3.isConfigured()) return this.s3.delete(key);
    if (this.driver === 'r2' && this.r2.isConfigured()) return this.r2.delete(key);
    return this.localDisk.delete(key);
  }

  activeDriver(): string {
    if (this.driver === 's3' && this.s3.isConfigured()) return 's3';
    if (this.driver === 'r2' && this.r2.isConfigured()) return 'r2';
    return 'local';
  }
}
