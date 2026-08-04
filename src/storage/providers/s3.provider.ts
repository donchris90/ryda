import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const PRESIGNED_URL_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

@Injectable()
export class S3Provider {
  private readonly client: S3Client | null;
  private readonly bucket: string;

  constructor(private readonly config: ConfigService) {
    this.bucket = this.config.get<string>('storage.s3Bucket') ?? '';
    const accessKeyId = this.config.get<string>('storage.s3AccessKeyId');
    const secretAccessKey = this.config.get<string>('storage.s3SecretAccessKey');

    this.client =
      accessKeyId && secretAccessKey
        ? new S3Client({
            region: this.config.get<string>('storage.s3Region'),
            credentials: { accessKeyId, secretAccessKey },
          })
        : null;
  }

  isConfigured(): boolean {
    return !!this.client && !!this.bucket;
  }

  async upload(buffer: Buffer, key: string, mimetype: string): Promise<string> {
    if (!this.client) throw new InternalServerErrorException('S3 is not configured');

    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: buffer, ContentType: mimetype }),
    );
    return this.getSignedReadUrl(key);
  }

  async delete(key: string): Promise<void> {
    if (!this.client) throw new InternalServerErrorException('S3 is not configured');
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async getSignedReadUrl(key: string): Promise<string> {
    if (!this.client) throw new InternalServerErrorException('S3 is not configured');
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.client, command, { expiresIn: PRESIGNED_URL_TTL_SECONDS });
  }
}
