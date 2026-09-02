import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Vehicle } from './entities/vehicle.entity';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { VehicleStatus } from '../common/enums/vehicle.enum';
import { User } from '../users/entities/user.entity';

@Injectable()
export class VehiclesService {
  constructor(
    @InjectRepository(Vehicle)
    private readonly vehiclesRepo: Repository<Vehicle>,
  ) {}

  async registerForDriver(driverId: string, dto: CreateVehicleDto): Promise<Vehicle> {
    const vehicle = this.vehiclesRepo.create({ ...dto, driverId });
    return this.vehiclesRepo.save(vehicle);
  }

  async findByDriver(driverId: string): Promise<Vehicle[]> {
    return this.vehiclesRepo.find({ where: { driverId } });
  }

  async findById(id: string): Promise<Vehicle> {
    const vehicle = await this.vehiclesRepo.findOne({ where: { id } });
    if (!vehicle) throw new NotFoundException('Vehicle not found');
    return vehicle;
  }

  async setStatus(id: string, status: VehicleStatus): Promise<Vehicle> {
    const vehicle = await this.findById(id);
    vehicle.status = status;
    return this.vehiclesRepo.save(vehicle);
  }

  async assignToFleet(vehicleId: string, fleetCompanyId: string | null): Promise<Vehicle> {
    const vehicle = await this.findById(vehicleId);
    vehicle.fleetCompanyId = fleetCompanyId;
    return this.vehiclesRepo.save(vehicle);
  }

  // Admin override for ride category matching - see doesVehicleMatchRideCategory()
  // in ride-vehicle-match.util.ts for the full reasoning. Passing an
  // empty array clears any previously-approved extra categories,
  // rather than leaving them stuck once granted.
  async setApprovedRideCategories(vehicleId: string, categories: string[]): Promise<Vehicle> {
    const vehicle = await this.findById(vehicleId);
    vehicle.approvedRideCategories = categories.length > 0 ? categories : null;
    return this.vehiclesRepo.save(vehicle);
  }

  async listByFleet(fleetCompanyId: string): Promise<Vehicle[]> {
    return this.vehiclesRepo.find({ where: { fleetCompanyId } });
  }

  /**
   * There was no way at all for an admin to see a list of vehicles
   * before this — a real gap alongside the driver/rides/support/users
   * ones already found. `Vehicle.driverId` already stores the raw User
   * id directly (registerForDriver is called with user.id, not a
   * DriverProfile id), so this is a single-hop join, not two.
   */
  async listForAdmin(filter?: { status?: VehicleStatus }, page = 1, limit = 25) {
    const qb = this.vehiclesRepo
      .createQueryBuilder('vehicle')
      .leftJoin(User, 'driver', 'driver.id::text = vehicle.driverId')
      .select('vehicle.id', 'id')
      .addSelect('vehicle.category', 'category')
      .addSelect('vehicle.make', 'make')
      .addSelect('vehicle.model', 'model')
      .addSelect('vehicle.year', 'year')
      .addSelect('vehicle.color', 'color')
      .addSelect('vehicle.plateNumber', 'plateNumber')
      .addSelect('vehicle.insuranceExpiry', 'insuranceExpiry')
      .addSelect('vehicle.roadWorthinessExpiry', 'roadWorthinessExpiry')
      .addSelect('vehicle.status', 'status')
      .addSelect('vehicle.approvedRideCategories', 'approvedRideCategories')
      .addSelect('vehicle.createdAt', 'createdAt')
      .addSelect('driver.firstName', 'driverFirstName')
      .addSelect('driver.lastName', 'driverLastName')
      .addSelect('driver.phone', 'driverPhone')
      .orderBy('vehicle.createdAt', 'DESC');

    if (filter?.status) qb.andWhere('vehicle.status = :status', { status: filter.status });

    const total = await qb.getCount();
    const rawItems = await qb
      .offset((page - 1) * limit)
      .limit(limit)
      .getRawMany();

    // getRawMany() bypasses TypeORM's normal simple-array
    // transformation, so approvedRideCategories comes back as a raw
    // "a,b,c" string here even though the entity-based endpoints return
    // a genuine array for the same column - converting it back keeps
    // the API contract consistent regardless of which endpoint a
    // caller used.
    const items = rawItems.map((item) => ({
      ...item,
      approvedRideCategories: item.approvedRideCategories
        ? String(item.approvedRideCategories).split(',')
        : null,
    }));

    return { items, total, page, limit };
  }
}
