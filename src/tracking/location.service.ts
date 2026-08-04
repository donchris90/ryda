import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { OnEvent } from '@nestjs/event-emitter';
import { LocationHistory } from './entities/location-history.entity';
import { Ride } from '../rides/entities/ride.entity';
import { RideStatus } from '../common/enums/ride.enum';
import { TrackingGateway } from './tracking.gateway';

const ACTIVE_STATUSES = [RideStatus.ACCEPTED, RideStatus.ARRIVING, RideStatus.ARRIVED, RideStatus.IN_PROGRESS];

@Injectable()
export class LocationService {
  constructor(
    @InjectRepository(LocationHistory)
    private readonly historyRepo: Repository<LocationHistory>,
    @InjectRepository(Ride)
    private readonly ridesRepo: Repository<Ride>,
    private readonly trackingGateway: TrackingGateway,
  ) {}

  @OnEvent('driver.location.updated')
  async onDriverLocationUpdated(payload: {
    driverUserId: string;
    lat: number;
    lng: number;
    at: Date;
  }): Promise<void> {
    const activeRide = await this.ridesRepo.findOne({
      where: { driverId: payload.driverUserId, status: In(ACTIVE_STATUSES) },
    });

    await this.historyRepo.save(
      this.historyRepo.create({
        driverUserId: payload.driverUserId,
        rideId: activeRide?.id ?? null,
        lat: payload.lat,
        lng: payload.lng,
      }),
    );

    if (activeRide) {
      this.trackingGateway.broadcastDriverLocation(activeRide.id, {
        lat: payload.lat,
        lng: payload.lng,
        at: payload.at,
      });
    }
  }
}
