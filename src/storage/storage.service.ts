import { BadRequestException, Injectable } from '@nestjs/common';
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

/**
 * Per-folder allowed MIME types. Deliberately keyed by folder, not a
 * single global list — a driver's license can reasonably be a PDF, a
 * profile photo can't. Anything not listed here (and any folder not in
 * this map at all — which the controller normalizes to 'misc') only
 * accepts plain images, which keeps the "unrecognised folder" fallback
 * from becoming an unrestricted upload endpoint.
 */
export const ALLOWED_MIME_TYPES: Record<string, string[]> = {
  'driver-documents': ['application/pdf', 'image/jpeg', 'image/png'],
  'vehicle-photos': ['image/jpeg', 'image/png', 'image/webp'],
  'chat-attachments': [
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf',
  ],
  'support-evidence': [
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf',
  ],
  'profile-photos': ['image/jpeg', 'image/png', 'image/webp'],
  misc: ['image/jpeg', 'image/png'],
};

const EXTENSION_BY_MIME: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10MB

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
  async upload(
    file: UploadedFile,
    folder: string,
  ): Promise<{ url: string; key: string }> {
    if (!file.buffer || file.buffer.length === 0) {
      throw new BadRequestException('Uploaded file is empty');
    }
    if (file.buffer.length > MAX_UPLOAD_BYTES) {
      throw new BadRequestException(
        `File exceeds the maximum upload size of ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB`,
      );
    }

    const allowed = ALLOWED_MIME_TYPES[folder] ?? ALLOWED_MIME_TYPES.misc;
    if (!allowed.includes(file.mimetype)) {
      throw new BadRequestException(
        `File type ${file.mimetype} isn't allowed for ${folder}. Allowed: ${allowed.join(', ')}`,
      );
    }

    // Extension comes from a fixed mimetype -> extension map, never from
    // the client-supplied `originalname` — a crafted filename (double
    // extensions, embedded path separators, etc.) can't influence the
    // key we generate and later use to read files back off disk.
    const extension = EXTENSION_BY_MIME[file.mimetype];
    const key = `${folder}/${randomUUID()}.${extension}`;

    if (this.driver === 's3' && this.s3.isConfigured()) {
      return {
        url: await this.s3.upload(file.buffer, key, file.mimetype),
        key,
      };
    }
    if (this.driver === 'r2' && this.r2.isConfigured()) {
      return {
        url: await this.r2.upload(file.buffer, key, file.mimetype),
        key,
      };
    }

    // Falls back to local disk if the configured cloud driver isn't actually
    // configured yet — same "don't break dev/test without real credentials"
    // pattern as Paystack/Maps/notification providers. (Refused outright in
    // production — see assertProductionStorageIsConfigured in main.ts.)
    return { url: await this.localDisk.upload(file.buffer, key), key };
  }

  async readLocal(key: string): Promise<Buffer> {
    return this.localDisk.read(key);
  }

  async delete(key: string): Promise<void> {
    if (this.driver === 's3' && this.s3.isConfigured())
      return this.s3.delete(key);
    if (this.driver === 'r2' && this.r2.isConfigured())
      return this.r2.delete(key);
    return this.localDisk.delete(key);
  }

  activeDriver(): string {
    if (this.driver === 's3' && this.s3.isConfigured()) return 's3';
    if (this.driver === 'r2' && this.r2.isConfigured()) return 'r2';
    return 'local';
  }

  /** For the production boot-time check in main.ts — see assertProductionStorageIsConfigured. */
  configuredDriver(): string {
    return this.driver;
  }

  isS3Configured(): boolean {
    return this.s3.isConfigured();
  }

  isR2Configured(): boolean {
    return this.r2.isConfigured();
  }
}