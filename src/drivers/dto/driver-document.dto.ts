import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { DriverDocumentType } from '../entities/driver-document.entity';

export class UploadDocumentDto {
  @IsEnum(DriverDocumentType)
  type: DriverDocumentType;

  @IsString()
  documentUrl: string;

  @IsOptional()
  @IsString()
  expiryDate?: string;
}

export class ReviewDocumentDto {
  // Required, not optional: a driver-app document card only shows a
  // rejection reason when one exists (documents.tsx), so an admin
  // rejecting without typing one leaves the driver looking at a
  // "Rejected" badge with no idea what to fix or re-upload.
  @IsString()
  @IsNotEmpty({ message: 'A rejection reason is required so the driver knows what to fix.' })
  rejectionReason: string;
}
