import { IsEnum, IsNumber, IsOptional, IsString } from 'class-validator';
import { IncidentType } from '../entities/incident.entity';

export class ReportIncidentDto {
  @IsEnum(IncidentType)
  type: IncidentType;

  @IsOptional()
  @IsString()
  rideId?: string;

  @IsString()
  description: string;

  @IsOptional()
  @IsNumber()
  lat?: number;

  @IsOptional()
  @IsNumber()
  lng?: number;
}

export class ResolveIncidentDto {
  @IsString()
  notes: string;
}

export class AddIncidentNoteDto {
  @IsString()
  note: string;
}

export class ForceCancelRideDto {
  @IsString()
  reason: string;
}
