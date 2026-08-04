import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PostgresSearchProvider } from './providers/postgres-search.provider';
import { OpenSearchProvider } from './providers/opensearch.provider';

@Injectable()
export class SearchService {
  private readonly driver: string;

  constructor(
    private readonly config: ConfigService,
    private readonly postgres: PostgresSearchProvider,
    private readonly openSearch: OpenSearchProvider,
  ) {
    this.driver = this.config.get<string>('search.driver')!;
  }

  private useOpenSearch(): boolean {
    return this.driver === 'opensearch' && this.openSearch.isConfigured();
  }

  async searchAirports(query: string) {
    if (this.useOpenSearch()) {
      return this.openSearch.search('airports', query, ['name', 'iataCode', 'city']);
    }
    return this.postgres.searchAirports(query);
  }

  async searchVehicles(query: string) {
    if (this.useOpenSearch()) {
      return this.openSearch.search('vehicles', query, ['plateNumber', 'make', 'model']);
    }
    return this.postgres.searchVehicles(query);
  }

  async searchDrivers(query: string) {
    if (this.useOpenSearch()) {
      return this.openSearch.search('drivers', query, ['firstName', 'lastName', 'phone', 'licenseNumber']);
    }
    return this.postgres.searchDrivers(query);
  }

  async searchSupportTickets(query: string) {
    if (this.useOpenSearch()) {
      return this.openSearch.search('support_tickets', query, ['subject', 'description']);
    }
    return this.postgres.searchSupportTickets(query);
  }

  async searchPassengers(query: string) {
    if (this.useOpenSearch()) {
      return this.openSearch.search('passengers', query, ['firstName', 'lastName', 'phone', 'email']);
    }
    return this.postgres.searchPassengers(query);
  }

  async searchCorporateAccounts(query: string) {
    if (this.useOpenSearch()) {
      return this.openSearch.search('corporate_accounts', query, ['companyName']);
    }
    return this.postgres.searchCorporateAccounts(query);
  }

  activeDriver(): string {
    return this.useOpenSearch() ? 'opensearch' : 'postgres';
  }
}
