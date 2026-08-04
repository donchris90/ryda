import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { StorageService } from './storage.service';

const ALLOWED_FOLDERS = ['driver-documents', 'vehicle-photos', 'chat-attachments', 'support-evidence', 'profile-photos'];

@ApiTags('storage')
@Controller('storage')
export class StorageController {
  constructor(private readonly storageService: StorageService) {}

  @Post('upload/:folder')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file'))
  async upload(@UploadedFile() file: Express.Multer.File, @Param('folder') folder: string) {
    const safeFolder = ALLOWED_FOLDERS.includes(folder) ? folder : 'misc';
    const result = await this.storageService.upload(
      { buffer: file.buffer, originalname: file.originalname, mimetype: file.mimetype },
      safeFolder,
    );
    return { ...result, driver: this.storageService.activeDriver() };
  }

  /** Only meaningful when the local-disk driver is active — S3/R2 URLs are presigned and self-serving. */
  @Get('files/:folder/:filename')
  async serveLocal(
    @Param('folder') folder: string,
    @Param('filename') filename: string,
    @Res() res: Response,
  ) {
    try {
      const buffer = await this.storageService.readLocal(`${folder}/${filename}`);
      res.send(buffer);
    } catch {
      throw new NotFoundException('File not found');
    }
  }
}
