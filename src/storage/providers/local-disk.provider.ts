import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs/promises';
import * as path from 'path';

@Injectable()
export class LocalDiskProvider {
  private readonly uploadDir: string;
  private readonly baseUrl: string;

  constructor(private readonly config: ConfigService) {
    this.uploadDir = this.config.get<string>('storage.localUploadDir')!;
    this.baseUrl = this.config.get<string>('storage.localBaseUrl')!;
  }

  async upload(buffer: Buffer, key: string): Promise<string> {
    const fullPath = path.join(this.uploadDir, key);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, buffer);
    return `${this.baseUrl}/${key}`;
  }

  async read(key: string): Promise<Buffer> {
    return fs.readFile(path.join(this.uploadDir, key));
  }

  async delete(key: string): Promise<void> {
    await fs.unlink(path.join(this.uploadDir, key)).catch(() => undefined);
  }
}
