import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OnEvent, EventEmitter2 } from '@nestjs/event-emitter';
import { Geofence, GeofenceType } from './entities/geofence.entity';
import { GeofenceEvent } from './entities/geofence-event.entity';
import { CreateGeofenceDto } from './dto/geofence.dto';
import { haversineDistanceKm } from '../../common/utils/geo.util';

const MONITORED_TYPES = [GeofenceType.RESTRICTED, GeofenceType.ALERT_ZONE];

@Injectable()
export class GeofenceService {
  constructor(
    @InjectRepository(Geofence)
    private readonly geofencesRepo: Repository<Geofence>,
    @InjectRepository(GeofenceEvent)
    private readonly eventsRepo: Repository<GeofenceEvent>,
    private readonly events: EventEmitter2,
  ) {}

  async create(dto: CreateGeofenceDto): Promise<Geofence> {
    return this.geofencesRepo.save(this.geofencesRepo.create(dto));
  }

  async listActive(type?: GeofenceType): Promise<Geofence[]> {
    return this.geofencesRepo.find({
      where: type ? { isActive: true, type } : { isActive: true },
      order: { name: 'ASC' },
    });
  }

  async listAll(): Promise<Geofence[]> {
    return this.geofencesRepo.find({ order: { createdAt: 'DESC' } });
  }

  async setActive(id: string, isActive: boolean): Promise<Geofence> {
    await this.geofencesRepo.update(id, { isActive });
    return this.geofencesRepo.findOne({ where: { id } }) as Promise<Geofence>;
  }

  /** Every active geofence (of any type) containing the given point — real distance math, not a bounding box. */
  async checkPoint(lat: number, lng: number): Promise<Geofence[]> {
    const active = await this.geofencesRepo.find({ where: { isActive: true } });
    return active.filter((g) => haversineDistanceKm(lat, lng, g.centerLat, g.centerLng) <= g.radiusKm);
  }

  /** Whether the point falls inside at least one active service-area zone — false if no service areas are defined at all (open by default). */
  async isWithinServiceArea(lat: number, lng: number): Promise<boolean> {
    const serviceAreas = await this.listActive(GeofenceType.SERVICE_AREA);
    if (serviceAreas.length === 0) return true;
    return serviceAreas.some((g) => haversineDistanceKm(lat, lng, g.centerLat, g.centerLng) <= g.radiusKm);
  }

  async listEventsForDriver(driverUserId: string): Promise<GeofenceEvent[]> {
    return this.eventsRepo.find({ where: { driverUserId }, order: { createdAt: 'DESC' }, take: 50 });
  }

  async listRecentEvents(): Promise<GeofenceEvent[]> {
    return this.eventsRepo.find({ order: { createdAt: 'DESC' }, take: 100 });
  }

  /**
   * Real-time monitoring — listens for the same driver.location.updated
   * event LocationService (tracking module) already consumes for route
   * history, and checks it against restricted/alert zones. A driver
   * entering one gets a logged GeofenceEvent + an emitted event other
   * modules (notifications, fraud) can react to.
   */
  @OnEvent('driver.location.updated')
  async onDriverLocationUpdated(payload: { driverUserId: string; lat: number; lng: number }): Promise<void> {
    const zones = await this.geofencesRepo.find({ where: { isActive: true } });
    const monitored = zones.filter((z) => MONITORED_TYPES.includes(z.type));

    for (const zone of monitored) {
      const distanceKm = haversineDistanceKm(payload.lat, payload.lng, zone.centerLat, zone.centerLng);
      if (distanceKm <= zone.radiusKm) {
        await this.eventsRepo.save(
          this.eventsRepo.create({
            geofenceId: zone.id,
            geofenceName: zone.name,
            geofenceType: zone.type,
            driverUserId: payload.driverUserId,
            lat: payload.lat,
            lng: payload.lng,
          }),
        );
        this.events.emit('geofence.entered', {
          driverUserId: payload.driverUserId,
          geofenceName: zone.name,
          geofenceType: zone.type,
        });
      }
    }
  }
}
