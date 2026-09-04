import { IsEnum, IsOptional, IsString, IsUUID, IsUrl } from 'class-validator';
import { TicketCategory, TicketPriority } from '../entities/support-ticket.entity';

export class CreateTicketDto {
  @IsOptional()
  @IsEnum(TicketCategory)
  category?: TicketCategory;

  @IsString()
  subject: string;

  @IsString()
  description: string;

  @IsOptional()
  @IsUUID()
  rideId?: string;

  @IsOptional()
  @IsUUID()
  paymentId?: string;

  // Customer-submitted tickets default to NORMAL (see SupportService.
  // createTicket()) - this is here mainly so staff-created tickets
  // (e.g. a phone-in report an agent logs on the caller's behalf) can
  // set an accurate priority immediately, not for a customer to
  // self-declare their own ticket URGENT.
  @IsOptional()
  @IsEnum(TicketPriority)
  priority?: TicketPriority;
}

export class AddMessageDto {
  @IsString()
  message: string;

  // The uploaded file's URL from POST /storage/upload/support-evidence
  // - this DTO just links it to the message, it doesn't handle the
  // upload itself.
  @IsOptional()
  @IsUrl()
  attachmentUrl?: string;
}

export class AssignTicketDto {
  @IsUUID()
  agentUserId: string;
}

export class UpdateTicketPriorityDto {
  @IsEnum(TicketPriority)
  priority: TicketPriority;
}
