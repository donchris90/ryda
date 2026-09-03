import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Airport } from './entities/airport.entity';
import { AirportZone } from './entities/airport-zone.entity';
import { AirportQueueEntry, AirportQueueStatus } from './entities/airport-queue-entry.entity';
import {
  CreateAirportDto,
  UpdateAirportDto,
  CreateAirportZoneDto,
  UpdateAirportZoneDto,
} from './dto/airport.dto';
import { haversineDistanceKm } from '../common/utils/geo.util';
import { RideCategory } from '../common/enums/ride.enum';
import { DriverProfile } from '../drivers/entities/driver-profile.entity';
import { Vehicle } from '../vehicles/entities/vehicle.entity';
import { VehicleStatus } from '../common/enums/vehicle.enum';
import { doesVehicleMatchRideCategory } from '../common/ride-vehicle-match.util';

@Injectable()
export class AirportService {
  constructor(
    @InjectRepository(Airport)
    private readonly airportsRepo: Repository<Airport>,
    @InjectRepository(AirportZone)
    private readonly zonesRepo: Repository<AirportZone>,
    @InjectRepository(AirportQueueEntry)
    private readonly queueRepo: Repository<AirportQueueEntry>,
    @InjectRepository(DriverProfile)
    private readonly driverProfilesRepo: Repository<DriverProfile>,
    @InjectRepository(Vehicle)
    private readonly vehiclesRepo: Repository<Vehicle>,
  ) {}

  async create(dto: CreateAirportDto): Promise<Airport> {
    return this.airportsRepo.save(this.airportsRepo.create(dto));
  }

  async update(id: string, dto: UpdateAirportDto): Promise<Airport> {
    const airport = await this.findById(id);
    Object.assign(airport, dto);
    return this.airportsRepo.save(airport);
  }

  async listActive(): Promise<Airport[]> {
    return this.airportsRepo.find({ where: { isActive: true }, order: { name: 'ASC' } });
  }

  /** Admin-facing - includes inactive airports, unlike listActive(). */
  async listAll(): Promise<Airport[]> {
    return this.airportsRepo.find({ order: { name: 'ASC' } });
  }

  async findById(id: string): Promise<Airport> {
    const airport = await this.airportsRepo.findOne({ where: { id } });
    if (!airport) throw new NotFoundException('Airport not found');
    return airport;
  }

  /** Finds the nearest active airport within its own geofence, if the point falls inside one. */
  async findContainingAirport(lat: number, lng: number): Promise<Airport | null> {
    const airports = await this.listActive();
    let nearest: { airport: Airport; distanceKm: number } | null = null;

    for (const airport of airports) {
      const distanceKm = haversineDistanceKm(lat, lng, airport.lat, airport.lng);
      if (distanceKm <= airport.geofenceRadiusKm) {
        if (!nearest || distanceKm < nearest.distanceKm) {
          nearest = { airport, distanceKm };
        }
      }
    }
    return nearest?.airport ?? null;
  }

  /**
   * True when this airport has no eligibility restriction configured
   * (the common case), or when it does and this category is on the
   * allowed list. Used to reject a ride request whose pickup was
   * pinned to a restricted airport with a category it doesn't serve
   * (see RidesService.requestRide()).
   */
  isVehicleCategoryEligible(airport: Airport, category: RideCategory): boolean {
    if (!airport.eligibleRideCategories?.length) return true;
    return airport.eligibleRideCategories.includes(category);
  }

  // ---- Named pickup zones ("Terminal 1 Arrivals", etc.) ----

  async createZone(airportId: string, dto: CreateAirportZoneDto): Promise<AirportZone> {
    await this.findById(airportId);
    return this.zonesRepo.save(this.zonesRepo.create({ airportId, ...dto }));
  }

  async updateZone(zoneId: string, dto: UpdateAirportZoneDto): Promise<AirportZone> {
    const zone = await this.findZoneById(zoneId);
    Object.assign(zone, dto);
    return this.zonesRepo.save(zone);
  }

  async findZoneById(zoneId: string): Promise<AirportZone> {
    const zone = await this.zonesRepo.findOne({ where: { id: zoneId } });
    if (!zone) throw new NotFoundException('Airport zone not found');
    return zone;
  }

  async listZones(airportId: string, includeInactive = false): Promise<AirportZone[]> {
    return this.zonesRepo.find({
      where: includeInactive ? { airportId } : { airportId, isActive: true },
      order: { name: 'ASC' },
    });
  }

  /**
   * Nearest active zone within its own (small, curbside) radius - a
   * point can only be "in" one zone at a time in practice since zones
   * are meant to be spaced apart, but nearest-wins the same way
   * findContainingAirport() does in case an admin sets overlapping
   * radii.
   */
  async findContainingZone(
    airportId: string,
    lat: number,
    lng: number,
  ): Promise<AirportZone | null> {
    const zones = await this.listZones(airportId);
    let nearest: { zone: AirportZone; distanceKm: number } | null = null;

    for (const zone of zones) {
      const distanceKm = haversineDistanceKm(lat, lng, zone.lat, zone.lng);
      if (distanceKm <= zone.radiusKm) {
        if (!nearest || distanceKm < nearest.distanceKm) {
          nearest = { zone, distanceKm };
        }
      }
    }
    return nearest?.zone ?? null;
  }

  // ---- Driver pickup queue ----

  /**
   * Captures the driver's current active-vehicle category at join
   * time (best-effort - a driver with no active vehicle can still
   * join, they just won't be preferred by a category-aware
   * dispatchNext() call later) so the queue can be dispatched by
   * category match, not just arrival order. See dispatchNext().
   */
  async joinQueue(airportId: string, driverUserId: string): Promise<AirportQueueEntry> {
    await this.findById(airportId);

    const existing = await this.queueRepo.findOne({
      where: { airportId, driverUserId, status: AirportQueueStatus.WAITING },
    });
    if (existing) throw new BadRequestException('Already in this airport queue');

    const vehicleCategory = await this.activeVehicleCategoryFor(driverUserId);

    return this.queueRepo.save(
      this.queueRepo.create({ airportId, driverUserId, vehicleCategory }),
    );
  }

  private async activeVehicleCategoryFor(driverUserId: string): Promise<string | null> {
    const profile = await this.driverProfilesRepo.findOne({ where: { userId: driverUserId } });
    if (!profile?.activeVehicleId) return null;

    const vehicle = await this.vehiclesRepo.findOne({ where: { id: profile.activeVehicleId } });
    if (!vehicle || vehicle.status !== VehicleStatus.ACTIVE) return null;

    return vehicle.category;
  }

  async leaveQueue(airportId: string, driverUserId: string): Promise<void> {
    await this.queueRepo.update(
      { airportId, driverUserId, status: AirportQueueStatus.WAITING },
      { status: AirportQueueStatus.LEFT },
    );
  }

  async listQueue(airportId: string): Promise<AirportQueueEntry[]> {
    return this.queueRepo.find({
      where: { airportId, status: AirportQueueStatus.WAITING },
      order: { joinedAt: 'ASC' },
    });
  }

  /**
   * Pops the next driver to dispatch. Plain FIFO (front of the queue)
   * when no requiredCategory is given - unchanged from before.
   *
   * When a requiredCategory IS given (a ride needing that category is
   * ready to dispatch to the airport queue), FIFO alone can hand the
   * ride to a driver whose vehicle doesn't actually serve it - the
   * driver right behind them might. So this instead walks the queue
   * in arrival order and dispatches the first entry whose captured
   * vehicleCategory genuinely matches (via the same
   * doesVehicleMatchRideCategory the rest of dispatch uses), skipping
   * non-matching entries in place rather than removing them from the
   * queue - they keep their position for a ride that does fit them.
   * Returns null (not the mismatched front-of-queue driver) when
   * nothing in the queue currently matches, so the caller can fall
   * back to normal matching instead of dispatching the wrong vehicle.
   */
  async dispatchNext(
    airportId: string,
    requiredCategory?: RideCategory,
  ): Promise<AirportQueueEntry | null> {
    const queue = await this.listQueue(airportId);
    if (queue.length === 0) return null;

    let next: AirportQueueEntry | null;
    if (!requiredCategory) {
      next = queue[0];
    } else {
      next =
        queue.find(
          (entry) =>
            !!entry.vehicleCategory &&
            doesVehicleMatchRideCategory(
              { category: entry.vehicleCategory as any },
              requiredCategory,
            ),
        ) ?? null;
    }

    if (!next) return null;

    next.status = AirportQueueStatus.DISPATCHED;
    next.dispatchedAt = new Date();
    return this.queueRepo.save(next);
  }

  async myQueuePosition(airportId: string, driverUserId: string): Promise<number | null> {
    const queue = await this.listQueue(airportId);
    const index = queue.findIndex((entry) => entry.driverUserId === driverUserId);
    return index === -1 ? null : index + 1;
  }
}
