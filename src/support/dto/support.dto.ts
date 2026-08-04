import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { TicketCategory } from '../entities/support-ticket.entity';

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
}

export class AddMessageDto {
  @IsString()
  message: string;
}

export class AssignTicketDto {
  @IsUUID()
  agentUserId: string;
}
