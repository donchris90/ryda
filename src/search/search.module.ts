import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Airport } from '../airport/entities/airport.entity';
import { DriverProfile } from '../drivers/entities/driver-profile.entity';
import { User } from '../users/entities/user.entity';
import { SupportTicket } from '../support/entities/support-ticket.entity';
import { Vehicle } from '../vehicles/entities/vehicle.entity';
import { CorporateAccount } from '../corporate/entities/corporate-account.entity';
import { SearchService } from './search.service';
import { SearchController } from './search.controller';
import { PostgresSearchProvider } from './providers/postgres-search.provider';
import { OpenSearchProvider } from './providers/opensearch.provider';

@Module({
  imports: [TypeOrmModule.forFeature([Airport, DriverProfile, User, SupportTicket, Vehicle, CorporateAccount])],
  providers: [SearchService, PostgresSearchProvider, OpenSearchProvider],
  controllers: [SearchController],
  exports: [SearchService],
})
export class SearchModule {}
