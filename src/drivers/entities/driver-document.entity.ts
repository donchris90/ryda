import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum DriverDocumentType {
  DRIVERS_LICENSE = 'drivers_license',
  INSURANCE = 'insurance',
  ROAD_WORTHINESS = 'road_worthiness',
  PROFILE_PHOTO = 'profile_photo',
  VEHICLE_PHOTO = 'vehicle_photo',
  BACKGROUND_CHECK = 'background_check',
}

export enum DriverDocumentStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

@Entity('driver_documents')
export class DriverDocument {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  driverProfileId: string;

  @Column({ type: 'enum', enum: DriverDocumentType })
  type: DriverDocumentType;

  @Column()
  documentUrl: string;

  @Column({ type: 'enum', enum: DriverDocumentStatus, default: DriverDocumentStatus.PENDING })
  status: DriverDocumentStatus;

  @Column({ type: 'varchar', nullable: true })
  reviewedBy: string | null;

  @Column({ type: 'varchar', nullable: true })
  rejectionReason: string | null;

  @Column({ type: 'timestamp', nullable: true })
  expiryDate: Date | null;

  // Set true once an expiry-warning notification has genuinely been
  // sent for this document, so the daily check doesn't re-notify the
  // driver every single day their document remains unrenewed — one
  // warning, then it stays quiet until either renewed (a new document
  // record entirely, per how uploads work here) or actually expired.
  @Column({ default: false })
  expiryWarningSent: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
