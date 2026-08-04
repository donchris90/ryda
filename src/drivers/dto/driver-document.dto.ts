import { IsEnum, IsOptional, IsString } from 'class-validator';
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
  @IsOptional()
  @IsString()
  rejectionReason?: string;
}
