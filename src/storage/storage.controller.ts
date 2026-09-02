import {
  BadRequestException,
  Controller,
  ForbiddenException,
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
import type { Request as ExpressRequest, Response } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ADMIN_LIKE_ROLES, UserRole } from '../common/enums/user-role.enum';
import {
  StorageService,
  ALLOWED_MIME_TYPES,
  MAX_UPLOAD_BYTES,
} from './storage.service';
import { DriverDocument } from '../drivers/entities/driver-document.entity';

const ALLOWED_FOLDERS = [
  'driver-documents',
  'vehicle-photos',
  'chat-attachments',
  'support-evidence',
  'profile-photos',
];

// Matches exactly what StorageService.upload() generates: a UUID plus one
// of the extensions in EXTENSION_BY_MIME. Anything else — path separators,
// `..`, null bytes, an unexpected extension — is rejected outright rather
// than passed through to the filesystem layer.
const SAFE_FILENAME =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|jpg|png|webp)$/i;

const STAFF_ROLES = [...ADMIN_LIKE_ROLES, UserRole.SUPPORT_AGENT];

@ApiTags('storage')
@Controller('storage')
export class StorageController {
  constructor(
    private readonly storageService: StorageService,
    @InjectRepository(DriverDocument)
    private readonly driverDocumentsRepo: Repository<DriverDocument>,
  ) {}

  @Post('upload/:folder')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_UPLOAD_BYTES },
      fileFilter: (req: ExpressRequest, file, callback) => {
        const rawFolder = req.params.folder;
        const folderParam = Array.isArray(rawFolder) ? rawFolder[0] : rawFolder;
        const folder = ALLOWED_FOLDERS.includes(folderParam)
          ? folderParam
          : 'misc';
        const allowed = ALLOWED_MIME_TYPES[folder] ?? ALLOWED_MIME_TYPES.misc;
        if (!allowed.includes(file.mimetype)) {
          callback(
            new BadRequestException(
              `File type ${file.mimetype} isn't allowed for ${folder}. Allowed: ${allowed.join(', ')}`,
            ),
            false,
          );
          return;
        }
        callback(null, true);
      },
    }),
  )
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Param('folder') folder: string,
  ) {
    const safeFolder = ALLOWED_FOLDERS.includes(folder) ? folder : 'misc';
    const result = await this.storageService.upload(
      {
        buffer: file.buffer,
        originalname: file.originalname,
        mimetype: file.mimetype,
      },
      safeFolder,
    );
    return { ...result, driver: this.storageService.activeDriver() };
  }

  /**
   * Only meaningful when the local-disk driver is active — S3/R2 URLs are
   * presigned and self-serving. Requires login for every folder, and for
   * driver-documents specifically (licenses, insurance, ID) also requires
   * the requester to either be the owning driver or hold a staff role —
   * these are the most sensitive files this endpoint can serve.
   */
  @Get('files/:folder/:filename')
  @UseGuards(JwtAuthGuard)
  async serveLocal(
    @Param('folder') folder: string,
    @Param('filename') filename: string,
    @CurrentUser() user: { id: string; role?: string; roles?: string[] },
    @Res() res: Response,
  ) {
    if (!ALLOWED_FOLDERS.includes(folder) || !SAFE_FILENAME.test(filename)) {
      // Deliberately the same 404 as a genuinely missing file — an
      // invalid path shouldn't distinguish itself from "doesn't exist".
      throw new NotFoundException('File not found');
    }

    if (folder === 'driver-documents') {
      const userRoles = user.roles ?? (user.role ? [user.role] : []);
      const isStaff = STAFF_ROLES.some((r) => userRoles.includes(r));
      if (!isStaff) {
        const owned = await this.driverDocumentsRepo
          .createQueryBuilder('doc')
          .innerJoin(
            'driver_profiles',
            'profile',
            'profile.id = doc.driverProfileId',
          )
          .where('profile.userId = :userId', { userId: user.id })
          .andWhere('doc.documentUrl LIKE :suffix', {
            suffix: `%/${folder}/${filename}`,
          })
          .getExists();
        if (!owned) {
          throw new ForbiddenException(
            "You don't have access to this document",
          );
        }
      }
    }

    try {
      const buffer = await this.storageService.readLocal(
        `${folder}/${filename}`,
      );
      res.send(buffer);
    } catch {
      throw new NotFoundException('File not found');
    }
  }
}