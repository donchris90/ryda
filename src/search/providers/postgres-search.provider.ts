import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Airport } from '../../airport/entities/airport.entity';
import { DriverProfile } from '../../drivers/entities/driver-profile.entity';
import { User } from '../../users/entities/user.entity';
import { SupportTicket } from '../../support/entities/support-ticket.entity';
import { Vehicle } from '../../vehicles/entities/vehicle.entity';
import { CorporateAccount } from '../../corporate/entities/corporate-account.entity';

@Injectable()
export class PostgresSearchProvider {
  constructor(
    @InjectRepository(Airport) private readonly airportsRepo: Repository<Airport>,
    @InjectRepository(DriverProfile) private readonly driversRepo: Repository<DriverProfile>,
    @InjectRepository(SupportTicket) private readonly ticketsRepo: Repository<SupportTicket>,
    @InjectRepository(Vehicle) private readonly vehiclesRepo: Repository<Vehicle>,
    @InjectRepository(User) private readonly usersRepo: Repository<User>,
    @InjectRepository(CorporateAccount) private readonly corporateRepo: Repository<CorporateAccount>,
  ) {}

  async searchAirports(query: string, limit = 10) {
    return this.airportsRepo
      .createQueryBuilder('a')
      .where('a.name ILIKE :q OR a.iataCode ILIKE :q OR a.city ILIKE :q', { q: `%${query}%` })
      .limit(limit)
      .getMany();
  }

  async searchVehicles(query: string, limit = 10) {
    return this.vehiclesRepo
      .createQueryBuilder('v')
      .where('v.plateNumber ILIKE :q OR v.make ILIKE :q OR v.model ILIKE :q', { q: `%${query}%` })
      .limit(limit)
      .getMany();
  }

  async searchDrivers(query: string, limit = 10) {
    return this.driversRepo
      .createQueryBuilder('driver')
      .leftJoin(User, 'user', 'user.id = driver.userId')
      .select([
        'driver.id AS "driverProfileId"',
        'driver.userId AS "userId"',
        'driver.level AS level',
        'driver.city AS city',
        'user.firstName AS "firstName"',
        'user.lastName AS "lastName"',
        'user.phone AS phone',
      ])
      .where('user.firstName ILIKE :q OR user.lastName ILIKE :q OR user.phone ILIKE :q OR driver.licenseNumber ILIKE :q', {
        q: `%${query}%`,
      })
      .limit(limit)
      .getRawMany();
  }

  async searchSupportTickets(query: string, limit = 10) {
    return this.ticketsRepo
      .createQueryBuilder('t')
      .where('t.subject ILIKE :q OR t.description ILIKE :q', { q: `%${query}%` })
      .limit(limit)
      .getMany();
  }

  async searchPassengers(query: string, limit = 10) {
    return this.usersRepo
      .createQueryBuilder('u')
      .select(['u.id AS id', 'u.firstName AS "firstName"', 'u.lastName AS "lastName"', 'u.phone AS phone', 'u.email AS email'])
      .where('u.role = :role', { role: 'passenger' })
      .andWhere('u.firstName ILIKE :q OR u.lastName ILIKE :q OR u.phone ILIKE :q OR u.email ILIKE :q', {
        q: `%${query}%`,
      })
      .limit(limit)
      .getRawMany();
  }

  async searchCorporateAccounts(query: string, limit = 10) {
    return this.corporateRepo
      .createQueryBuilder('c')
      .where('c.companyName ILIKE :q', { q: `%${query}%` })
      .limit(limit)
      .getMany();
  }
}
