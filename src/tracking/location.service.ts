import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { OnEvent } from '@nestjs/event-emitter';
import { LocationHistory } from './entities/location-history.entity';
import { Ride } from '../rides/entities/ride.entity';
import { RideStatus } from '../common/enums/ride.enum';
import {
  DeliveryOrder,
  DeliveryStatus,
} from '../logistics/entities/delivery-order.entity';
import { TrackingGateway } from './tracking.gateway';

const ACTIVE_STATUSES = [
  RideStatus.ACCEPTED,
  RideStatus.ARRIVING,
  RideStatus.ARRIVED,
  RideStatus.IN_PROGRESS,
];
const ACTIVE_DELIVERY_STATUSES = [
  DeliveryStatus.ACCEPTED,
  DeliveryStatus.PICKUP_ARRIVED,
  DeliveryStatus.PICKED_UP,
  DeliveryStatus.IN_TRANSIT,
];

@Injectable()
export class LocationService {
  constructor(
    @InjectRepository(LocationHistory)
    private readonly historyRepo: Repository<LocationHistory>,
    @InjectRepository(Ride)
    private readonly ridesRepo: Repository<Ride>,
    @InjectRepository(DeliveryOrder)
    private readonly deliveryOrdersRepo: Repository<DeliveryOrder>,
    private readonly trackingGateway: TrackingGateway,
  ) {}

  @OnEvent('driver.location.updated')
  async onDriverLocationUpdated(payload: {
    driverUserId: string;
    lat: number;
    lng: number;
    at: Date;
  }): Promise<void> {
    // A driver can plausibly be on a ride and a delivery at once isn't
    // expected in this app's model, but checking both independently
    // (not else-if) costs nothing and doesn't assume that won't ever
    // change.
    const [activeRide, activeDelivery] = await Promise.all([
      this.ridesRepo.findOne({
        where: { driverId: payload.driverUserId, status: In(ACTIVE_STATUSES) },
      }),
      this.deliveryOrdersRepo.findOne({
        where: {
          driverId: payload.driverUserId,
          status: In(ACTIVE_DELIVERY_STATUSES),
        },
      }),
    ]);

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

    if (activeDelivery) {
      this.trackingGateway.broadcastDeliveryLocation(activeDelivery.id, {
        lat: payload.lat,
        lng: payload.lng,
        at: payload.at,
      });
    }

    // Every update goes to the admin live-map room, ride or no ride, so
    // idle-but-online drivers still move on the admin map, not just ones
    // currently on a trip.
    this.trackingGateway.broadcastAdminDriverLocation({
      driverId: payload.driverUserId,
      lat: payload.lat,
      lng: payload.lng,
      at: payload.at,
      rideId: activeRide?.id ?? null,
    });
  }
}
