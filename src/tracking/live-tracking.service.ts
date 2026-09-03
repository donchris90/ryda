import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Ride } from '../rides/entities/ride.entity';
import { RideStatus } from '../common/enums/ride.enum';
import { DeliveryOrder, DeliveryStatus } from '../logistics/entities/delivery-order.entity';
import { DriverProfile } from '../drivers/entities/driver-profile.entity';
import { DriverAvailability, ONLINE_AVAILABILITIES } from '../common/enums/driver-status.enum';
import { User } from '../users/entities/user.entity';

const ACTIVE_RIDE_STATUSES = [
  RideStatus.ACCEPTED,
  RideStatus.ARRIVING,
  RideStatus.ARRIVED,
  RideStatus.IN_PROGRESS,
];

// Same set LocationService.ACTIVE_DELIVERY_STATUSES uses to decide
// whether a driver's location update should broadcast to a delivery's
// room - kept in sync by hand since that constant is private to that
// file, not exported for reuse.
const ACTIVE_DELIVERY_STATUSES = [
  DeliveryStatus.ACCEPTED,
  DeliveryStatus.PICKUP_ARRIVED,
  DeliveryStatus.PICKED_UP,
  DeliveryStatus.IN_TRANSIT,
];

export interface AdminLiveRide {
  rideId: string;
  status: RideStatus;
  driverId: string | null;
  driverName: string | null;
  passengerId: string;
  passengerName: string | null;
  pickupLat: number;
  pickupLng: number;
  dropoffLat: number;
  dropoffLng: number;
  driverLat: number | null;
  driverLng: number | null;
  locationUpdatedAt: Date | null;
}

export interface AdminLiveDriver {
  driverId: string;
  name: string | null;
  city: string | null;
  lat: number;
  lng: number;
  locationUpdatedAt: Date | null;
}

export interface AdminLiveDelivery {
  deliveryId: string;
  status: DeliveryStatus;
  driverId: string | null;
  driverName: string | null;
  customerId: string;
  customerName: string | null;
  pickupLat: number;
  pickupLng: number;
  pickupAddress: string;
  dropoffLat: number;
  dropoffLng: number;
  dropoffAddress: string;
  dropoffContactName: string;
  driverLat: number | null;
  driverLng: number | null;
  locationUpdatedAt: Date | null;
}

@Injectable()
export class LiveTrackingService {
  constructor(
    @InjectRepository(Ride)
    private readonly ridesRepo: Repository<Ride>,
    @InjectRepository(DeliveryOrder)
    private readonly deliveryOrdersRepo: Repository<DeliveryOrder>,
    @InjectRepository(DriverProfile)
    private readonly driverProfilesRepo: Repository<DriverProfile>,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
  ) {}

  /**
   * `city` filters both lists by the driver's registered city. Ride pickup
   * coordinates aren't reverse-geocoded to a city anywhere in this codebase,
   * so filtering by the driver's city is the closest available proxy rather
   * than an exact match on where the ride itself is happening.
   */
  async getLiveSnapshot(
    city?: string,
  ): Promise<{ rides: AdminLiveRide[]; onlineDrivers: AdminLiveDriver[] }> {
    const activeRides = await this.ridesRepo.find({
      where: { status: In(ACTIVE_RIDE_STATUSES) },
    });

    const driverIdsOnRides = new Set(
      activeRides.map((r) => r.driverId).filter((id): id is string => !!id),
    );
    const passengerIds = new Set(activeRides.map((r) => r.passengerId));

    // Ride only stores driverId/passengerId (no ORM relations on the entity
    // — see RidesService.listForAdmin for the same pattern), so names are
    // resolved with a couple of manual lookups rather than a join config
    // that doesn't exist on Ride.
    const relevantUserIds = [
      ...new Set([...driverIdsOnRides, ...passengerIds]),
    ];

    const [driverProfiles, userRows] = await Promise.all([
      driverIdsOnRides.size
        ? this.driverProfilesRepo.find({
            where: { userId: In([...driverIdsOnRides]) },
          })
        : Promise.resolve([] as DriverProfile[]),
      relevantUserIds.length
        ? this.usersRepo.find({ where: { id: In(relevantUserIds) } })
        : Promise.resolve([] as User[]),
    ]);
    const profileByUserId = new Map(driverProfiles.map((p) => [p.userId, p]));
    const userById = new Map(userRows.map((u) => [u.id, u]));

    let rides: AdminLiveRide[] = activeRides.map((ride) => {
      const profile = ride.driverId
        ? profileByUserId.get(ride.driverId)
        : undefined;
      const driverUser = ride.driverId
        ? userById.get(ride.driverId)
        : undefined;
      const passengerUser = userById.get(ride.passengerId);
      return {
        rideId: ride.id,
        status: ride.status,
        driverId: ride.driverId,
        driverName: driverUser
          ? `${driverUser.firstName} ${driverUser.lastName}`
          : null,
        passengerId: ride.passengerId,
        passengerName: passengerUser
          ? `${passengerUser.firstName} ${passengerUser.lastName}`
          : null,
        pickupLat: ride.pickupLat,
        pickupLng: ride.pickupLng,
        dropoffLat: ride.dropoffLat,
        dropoffLng: ride.dropoffLng,
        driverLat: profile?.currentLat ?? null,
        driverLng: profile?.currentLng ?? null,
        locationUpdatedAt: profile?.locationUpdatedAt ?? null,
      };
    });

    const onlineProfiles = await this.driverProfilesRepo.find({
      where: {
        // Live map view: any driver currently reachable at all — every
        // online-for-X state, plus ON_TRIP so an in-progress trip's
        // driver doesn't vanish from the map mid-ride.
        availability: In([...ONLINE_AVAILABILITIES, DriverAvailability.ON_TRIP]),
        ...(city ? { city } : {}),
      },
      relations: { user: true },
    });

    // Drivers already surfaced via an active ride above stay in `rides` only,
    // so a single driver never renders as two separate markers on the map.
    const onlineDrivers: AdminLiveDriver[] = onlineProfiles
      .filter(
        (p) =>
          !driverIdsOnRides.has(p.userId) &&
          p.currentLat != null &&
          p.currentLng != null,
      )
      .map((p) => ({
        driverId: p.userId,
        name: p.user ? `${p.user.firstName} ${p.user.lastName}` : null,
        city: p.city,
        lat: p.currentLat as number,
        lng: p.currentLng as number,
        locationUpdatedAt: p.locationUpdatedAt,
      }));

    if (city) {
      rides = rides.filter((r) => {
        const profile = r.driverId
          ? profileByUserId.get(r.driverId)
          : undefined;
        return profile?.city === city;
      });
    }

    return { rides, onlineDrivers };
  }

  /**
   * Delivery equivalent of getLiveSnapshot() - active delivery orders
   * with their courier's last-known position, filtered by the
   * courier's registered city the same way rides are (delivery
   * pickup/dropoff coordinates aren't reverse-geocoded to a city
   * either). Deliberately its own method/endpoint rather than folded
   * into getLiveSnapshot()'s return shape - rides and deliveries are
   * shown on separate admin map views, so a caller only ever needs
   * one of the two per request.
   */
  async getLiveDeliveriesSnapshot(city?: string): Promise<{ deliveries: AdminLiveDelivery[] }> {
    const activeDeliveries = await this.deliveryOrdersRepo.find({
      where: { status: In(ACTIVE_DELIVERY_STATUSES) },
    });

    const driverIdsOnDeliveries = new Set(
      activeDeliveries.map((d) => d.driverId).filter((id): id is string => !!id),
    );
    const customerIds = new Set(activeDeliveries.map((d) => d.customerId));

    const relevantUserIds = [...new Set([...driverIdsOnDeliveries, ...customerIds])];

    const [driverProfiles, userRows] = await Promise.all([
      driverIdsOnDeliveries.size
        ? this.driverProfilesRepo.find({ where: { userId: In([...driverIdsOnDeliveries]) } })
        : Promise.resolve([] as DriverProfile[]),
      relevantUserIds.length
        ? this.usersRepo.find({ where: { id: In(relevantUserIds) } })
        : Promise.resolve([] as User[]),
    ]);
    const profileByUserId = new Map(driverProfiles.map((p) => [p.userId, p]));
    const userById = new Map(userRows.map((u) => [u.id, u]));

    let deliveries: AdminLiveDelivery[] = activeDeliveries.map((delivery) => {
      const profile = delivery.driverId ? profileByUserId.get(delivery.driverId) : undefined;
      const driverUser = delivery.driverId ? userById.get(delivery.driverId) : undefined;
      const customerUser = userById.get(delivery.customerId);
      return {
        deliveryId: delivery.id,
        status: delivery.status,
        driverId: delivery.driverId,
        driverName: driverUser ? `${driverUser.firstName} ${driverUser.lastName}` : null,
        customerId: delivery.customerId,
        customerName: customerUser ? `${customerUser.firstName} ${customerUser.lastName}` : null,
        pickupLat: delivery.pickupLat,
        pickupLng: delivery.pickupLng,
        pickupAddress: delivery.pickupAddress,
        dropoffLat: delivery.dropoffLat,
        dropoffLng: delivery.dropoffLng,
        dropoffAddress: delivery.dropoffAddress,
        dropoffContactName: delivery.dropoffContactName,
        driverLat: profile?.currentLat ?? null,
        driverLng: profile?.currentLng ?? null,
        locationUpdatedAt: profile?.locationUpdatedAt ?? null,
      };
    });

    if (city) {
      deliveries = deliveries.filter((d) => {
        const profile = d.driverId ? profileByUserId.get(d.driverId) : undefined;
        return profile?.city === city;
      });
    }

    return { deliveries };
  }
}
