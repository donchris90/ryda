import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
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
import { UploadedFile as UploadedFileRecord } from './entities/uploaded-file.entity';
import { Ride } from '../rides/entities/ride.entity';
import { SupportService } from '../support/support.service';

const ALLOWED_FOLDERS = [
  'driver-documents',
  'vehicle-photos',
  'chat-attachments',
  'support-evidence',
  'profile-photos',
];

// Folders whose files have no meaning without a parent record (a chat
// attachment belongs to a ride, evidence belongs to a ticket) and are
// therefore tracked in UploadedFile so serveLocal() can check real
// ownership instead of relying on the UUID filename being unguessable.
const CONTEXT_REQUIRED_FOLDERS: Record<string, 'ride' | 'ticket'> = {
  'chat-attachments': 'ride',
  'support-evidence': 'ticket',
};

// Matches exactly what StorageService.upload() generates: a UUID plus one
// of the extensions in EXTENSION_BY_MIME. Anything else — path separators,
// `..`, null bytes, an unexpected extension — is rejected outright rather
// than passed through to the filesystem layer.
const SAFE_FILENAME =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|jpg|png|webp)$/i;

const STAFF_ROLES = [...ADMIN_LIKE_ROLES, UserRole.SUPPORT_AGENT];

function isStaff(user: { role?: string; roles?: string[] }): boolean {
  const userRoles = user.roles ?? (user.role ? [user.role] : []);
  return STAFF_ROLES.some((r) => userRoles.includes(r));
}

@ApiTags('storage')
@Controller('storage')
export class StorageController {
  constructor(
    private readonly storageService: StorageService,
    private readonly supportService: SupportService,
    @InjectRepository(DriverDocument)
    private readonly driverDocumentsRepo: Repository<DriverDocument>,
    @InjectRepository(UploadedFileRecord)
    private readonly uploadedFilesRepo: Repository<UploadedFileRecord>,
    @InjectRepository(Ride)
    private readonly ridesRepo: Repository<Ride>,
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
    @CurrentUser() user: { id: string; role?: string; roles?: string[] },
    @Query('rideId') rideId?: string,
    @Query('ticketId') ticketId?: string,
  ) {
    const safeFolder = ALLOWED_FOLDERS.includes(folder) ? folder : 'misc';
    const requiredContext = CONTEXT_REQUIRED_FOLDERS[safeFolder];

    let contextId: string | null = null;
    if (requiredContext === 'ride') {
      if (!rideId) {
        throw new BadRequestException(
          'rideId is required when uploading a chat attachment',
        );
      }
      const ride = await this.ridesRepo.findOne({ where: { id: rideId } });
      if (
        !ride ||
        (ride.passengerId !== user.id && ride.driverId !== user.id)
      ) {
        throw new ForbiddenException("You don't have access to this ride");
      }
      contextId = rideId;
    } else if (requiredContext === 'ticket') {
      if (!ticketId) {
        throw new BadRequestException(
          'ticketId is required when uploading support evidence',
        );
      }
      // Throws ForbiddenException/NotFoundException itself if the caller can't access this ticket.
      await this.supportService.assertCanAccess(
        ticketId,
        user.id,
        user.role ?? '',
      );
      contextId = ticketId;
    }

    const result = await this.storageService.upload(
      {
        buffer: file.buffer,
        originalname: file.originalname,
        mimetype: file.mimetype,
      },
      safeFolder,
    );

    if (requiredContext) {
      // key is "folder/uuid.ext" — store just the filename part, matching what serveLocal() receives.
      const filename = result.key.slice(safeFolder.length + 1);
      await this.uploadedFilesRepo.save(
        this.uploadedFilesRepo.create({
          folder: safeFolder,
          filename,
          uploaderId: user.id,
          contextType: requiredContext,
          contextId,
        }),
      );
    }

    return { ...result, driver: this.storageService.activeDriver() };
  }

  /**
   * Only meaningful when the local-disk driver is active — S3/R2 URLs are
   * presigned and self-serving. Requires login for every folder, plus a
   * per-folder ownership check:
   *  - driver-documents: owning driver or staff only (licenses, insurance, ID).
   *  - chat-attachments / support-evidence: uploader, staff, or (via the
   *    UploadedFile record written at upload time) a participant of the
   *    same ride / someone with access to the same ticket. Files uploaded
   *    before this check existed have no UploadedFile record, so they
   *    fail closed rather than being served to anyone who asks.
   *  - vehicle-photos / profile-photos: deliberately left open to any
   *    authenticated user. These are shown to the other party on a ride
   *    (so a passenger can recognise the car, so either side can see who
   *    they're matched with) and aren't tied to a single "this ride only"
   *    relationship the way chat/support content is — restricting them
   *    would break that legitimate cross-user use case.
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

    if (folder === 'driver-documents' && !isStaff(user)) {
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
        throw new ForbiddenException("You don't have access to this document");
      }
    }

    const requiredContext = CONTEXT_REQUIRED_FOLDERS[folder];
    if (requiredContext && !isStaff(user)) {
      const record = await this.uploadedFilesRepo.findOne({
        where: { folder, filename },
      });
      if (!record) {
        // No ownership record — fail closed rather than serve it to anyone logged in.
        throw new NotFoundException('File not found');
      }
      if (record.uploaderId !== user.id) {
        if (record.contextType === 'ride' && record.contextId) {
          const ride = await this.ridesRepo.findOne({
            where: { id: record.contextId },
          });
          const isParticipant =
            !!ride &&
            (ride.passengerId === user.id || ride.driverId === user.id);
          if (!isParticipant) {
            throw new ForbiddenException("You don't have access to this file");
          }
        } else if (record.contextType === 'ticket' && record.contextId) {
          // Throws if the caller can't access this ticket.
          await this.supportService.assertCanAccess(
            record.contextId,
            user.id,
            user.role ?? '',
          );
        } else {
          throw new ForbiddenException("You don't have access to this file");
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
