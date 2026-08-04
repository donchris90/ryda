import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  DriverDocument,
  DriverDocumentStatus,
  DriverDocumentType,
} from './entities/driver-document.entity';
import { DriverProfile } from './entities/driver-profile.entity';
import { User } from '../users/entities/user.entity';
import { UploadDocumentDto } from './dto/driver-document.dto';

@Injectable()
export class DriverDocumentsService {
  constructor(
    @InjectRepository(DriverDocument)
    private readonly docsRepo: Repository<DriverDocument>,
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

  async listForDriver(driverProfileId: string): Promise<DriverDocument[]> {
    return this.docsRepo.find({ where: { driverProfileId }, order: { type: 'ASC' } });
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
}
