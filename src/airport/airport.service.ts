import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Airport } from './entities/airport.entity';
import { AirportQueueEntry, AirportQueueStatus } from './entities/airport-queue-entry.entity';
import { CreateAirportDto } from './dto/airport.dto';
import { haversineDistanceKm } from '../common/utils/geo.util';

@Injectable()
export class AirportService {
  constructor(
    @InjectRepository(Airport)
    private readonly airportsRepo: Repository<Airport>,
    @InjectRepository(AirportQueueEntry)
    private readonly queueRepo: Repository<AirportQueueEntry>,
  ) {}

  async create(dto: CreateAirportDto): Promise<Airport> {
    return this.airportsRepo.save(this.airportsRepo.create(dto));
  }

  async listActive(): Promise<Airport[]> {
    return this.airportsRepo.find({ where: { isActive: true }, order: { name: 'ASC' } });
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

  // ---- Driver pickup queue ----

  async joinQueue(airportId: string, driverUserId: string): Promise<AirportQueueEntry> {
    await this.findById(airportId);

    const existing = await this.queueRepo.findOne({
      where: { airportId, driverUserId, status: AirportQueueStatus.WAITING },
    });
    if (existing) throw new BadRequestException('Already in this airport queue');

    return this.queueRepo.save(this.queueRepo.create({ airportId, driverUserId }));
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

  /** Pops the front of the queue (FIFO) — call when a ride is ready to dispatch to the airport queue. */
  async dispatchNext(airportId: string): Promise<AirportQueueEntry | null> {
    const [next] = await this.listQueue(airportId);
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
