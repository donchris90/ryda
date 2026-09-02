import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { ApiKeysService } from './api-keys.service';
import { ApiKeyGuard } from './api-key.guard';
import { CreateApiKeyDto } from './dto/api-key.dto';
import { Audit } from '../audit/decorators/audit.decorator';
import { Ride } from '../rides/entities/ride.entity';

@Controller('admin/api-keys')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
export class ApiKeysController {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  @Post()
  @Audit('api_key.create')
  create(@Body() dto: CreateApiKeyDto) {
    return this.apiKeysService.create(dto);
  }

  @Get()
  list() {
    return this.apiKeysService.list();
  }

  @Delete(':id')
  @Audit('api_key.revoke')
  revoke(@Param('id') id: string) {
    return this.apiKeysService.revoke(id);
  }
}

/**
 * Demonstrative partner-facing endpoint — authenticated via x-api-key
 * instead of a JWT. A real partner API surface would have more of these
 * (booking, fare estimate, webhooks); this shows the auth mechanism works.
 */
@Controller('partner')
@UseGuards(ApiKeyGuard)
export class PartnerController {
  constructor(
    @InjectRepository(Ride)
    private readonly ridesRepo: Repository<Ride>,
  ) {}

  @Get('rides/:id/status')
  async rideStatus(@Param('id') id: string) {
    const ride = await this.ridesRepo.findOne({ where: { id } });
    if (!ride) throw new NotFoundException('Ride not found');
    return {
      id: ride.id,
      status: ride.status,
      pickupAddress: ride.pickupAddress,
      dropoffAddress: ride.dropoffAddress,
      totalFare: ride.totalFare,
      createdAt: ride.createdAt,
    };
  }
}
