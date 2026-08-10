import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThanOrEqual, MoreThan } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  DriverDocument,
  DriverDocumentStatus,
  DriverDocumentType,
} from './entities/driver-document.entity';
import { DriverProfile } from './entities/driver-profile.entity';
import { User } from '../users/entities/user.entity';
import { UploadDocumentDto } from './dto/driver-document.dto';

const EXPIRY_WARNING_WINDOW_DAYS = 7;

@Injectable()
export class DriverDocumentsService {
  private readonly logger = new Logger(DriverDocumentsService.name);

  constructor(
    @InjectRepository(DriverDocument)
    private readonly docsRepo: Repository<DriverDocument>,
    @InjectRepository(DriverProfile)
    private readonly profilesRepo: Repository<DriverProfile>,
    private readonly events: EventEmitter2,
  ) {}

  async upload(driverProfileId: string, dto: UploadDocumentDto): Promise<DriverDocument> {
    // Re-uploading a document type resets it to pending review rather than
    // creating a duplicate row — keeps "what's the current license" a
    // single source of truth per type.
    let doc = await this.docsRepo.findOne({
      where: { driverProfileId, type: dto.type },
    });
    if (!doc) {
      doc = this.docsRepo.create({ driverProfileId, type: dto.type });
    }
    doc.documentUrl = dto.documentUrl;
    doc.status = DriverDocumentStatus.PENDING;
    doc.rejectionReason = null;
    doc.expiryDate = dto.expiryDate ? new Date(dto.expiryDate) : null;
    return this.docsRepo.save(doc);
  }

  async listForDriver(driverProfileId: string): Promise<Omit<DriverDocument, 'reviewedBy'>[]> {
    const docs = await this.docsRepo.find({ where: { driverProfileId }, order: { type: 'ASC' } });
    // reviewedBy is an internal admin user id - no reason for it to
    // ever reach the driver's own app. Stripped here at the service
    // boundary, not left to the frontend to simply not render, since
    // the raw value would otherwise still be sitting in the network
    // response and app state regardless of what the UI shows.
    return docs.map(({ reviewedBy, ...rest }) => rest);
  }

  async findById(id: string): Promise<DriverDocument> {
    const doc = await this.docsRepo.findOne({ where: { id } });
    if (!doc) throw new NotFoundException('Document not found');
    return doc;
  }

  async approve(id: string, reviewerUserId: string): Promise<DriverDocument> {
    const doc = await this.findById(id);
    doc.status = DriverDocumentStatus.APPROVED;
    doc.reviewedBy = reviewerUserId;
    doc.rejectionReason = null;
    return this.docsRepo.save(doc);
  }

  async reject(id: string, reviewerUserId: string, reason: string): Promise<DriverDocument> {
    const doc = await this.findById(id);
    doc.status = DriverDocumentStatus.REJECTED;
    doc.reviewedBy = reviewerUserId;
    doc.rejectionReason = reason;
    return this.docsRepo.save(doc);
  }

  /** All required document types must be approved before a driver can be fully approved. */
  async hasAllRequiredApproved(driverProfileId: string): Promise<boolean> {
    const required = [
      DriverDocumentType.DRIVERS_LICENSE,
      DriverDocumentType.INSURANCE,
      DriverDocumentType.ROAD_WORTHINESS,
    ];
    const docs = await this.listForDriver(driverProfileId);

    return required.every((type) =>
      docs.some((doc) => doc.type === type && doc.status === DriverDocumentStatus.APPROVED),
    );
  }

  /**
   * Same "raw ID, no name" gap already found and fixed five times
   * elsewhere — here it's a two-hop join (document → driver profile →
   * user) rather than one, since DriverDocument only stores
   * driverProfileId, not a userId directly. Both cast to ::text
   * proactively (DriverProfile.id and User.id are real uuid columns,
   * the foreign-key-style string columns referencing them are plain
   * varchar — the same mismatch that hit rides and support before).
   */
  async listPendingReview() {
    return this.docsRepo
      .createQueryBuilder('doc')
      .leftJoin(DriverProfile, 'profile', 'profile.id::text = doc.driverProfileId')
      .leftJoin(User, 'driver', 'driver.id = profile.userId')
      .select('doc.id', 'id')
      .addSelect('doc.driverProfileId', 'driverProfileId')
      .addSelect('doc.type', 'type')
      .addSelect('doc.documentUrl', 'documentUrl')
      .addSelect('doc.status', 'status')
      .addSelect('doc.expiryDate', 'expiryDate')
      .addSelect('doc.createdAt', 'createdAt')
      .addSelect('driver.firstName', 'driverFirstName')
      .addSelect('driver.lastName', 'driverLastName')
      .addSelect('driver.phone', 'driverPhone')
      .where('doc.status = :status', { status: DriverDocumentStatus.PENDING })
      .orderBy('doc.createdAt', 'ASC')
      .getRawMany();
  }

  /**
   * Real gap found while checking notification coverage against the
   * full requested trigger list — expiryDate was only ever set on
   * upload and read for the admin list view, never actually checked
   * against the current date at all. A driver's license or insurance
   * could expire with nobody ever told.
   */
  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async checkExpiringDocuments(): Promise<void> {
    const now = new Date();
    const warningCutoff = new Date(now.getTime() + EXPIRY_WARNING_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const expiringSoon = await this.docsRepo.find({
      where: {
        status: DriverDocumentStatus.APPROVED,
        expiryDate: LessThanOrEqual(warningCutoff),
        expiryWarningSent: false,
      },
    });
    // Only ones that haven't already fully expired — a document that's
    // already expired needs a different message, not "expiring soon".
    const stillFuture = expiringSoon.filter((d) => d.expiryDate && d.expiryDate.getTime() > now.getTime());

    for (const doc of stillFuture) {
      try {
        const profile = await this.profilesRepo.findOne({ where: { id: doc.driverProfileId } });
        if (!profile) continue;
        const daysLeft = Math.ceil((doc.expiryDate!.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
        this.events.emit('driver.document.expiring', {
          userId: profile.userId,
          documentType: doc.type,
          daysLeft,
        });
        doc.expiryWarningSent = true;
        await this.docsRepo.save(doc);
      } catch (err) {
        // One driver's lookup failing shouldn't stop the rest of the
        // batch from being checked and notified.
        this.logger.error(`Failed to send expiry warning for document ${doc.id}`, err as Error);
      }
    }
  }
}
