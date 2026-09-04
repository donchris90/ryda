import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { RideCategory, RideStatus, PaymentMethod, CancelledBy } from '../../common/enums/ride.enum';
import { DispatchMode } from '../../candidate-search/candidate-search.types';

@Entity('rides')
export class Ride {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  passengerId: string;

  @Index()
  @Column({ type: 'varchar', nullable: true })
  driverId: string | null;

  @Column({ type: 'varchar', nullable: true })
  vehicleId: string | null;

  @Column({ type: 'enum', enum: RideCategory })
  category: RideCategory;

  @Index()
  @Column({ type: 'enum', enum: RideStatus, default: RideStatus.REQUESTED })
  status: RideStatus;

  // Chosen at request time. MANUAL (default, existing behavior): the ride
  // sits SEARCHING until the passenger picks a driver themselves via
  // POST /rides/:id/select-driver. AUTO: AutoDispatchService offers the
  // ride to the best-ranked eligible candidate automatically, moving to
  // the next candidate on decline/timeout. Both modes read from the same
  // shared CandidateSearchService/DriverRankingService pipeline — see
  // candidate-search.types.ts's DispatchMode doc comment for why this
  // must never branch matching logic on which mode a ride is in.
  @Column({ type: 'enum', enum: DispatchMode, default: DispatchMode.MANUAL })
  dispatchMode: DispatchMode;

  @Column('double precision')
  pickupLat: number;

  @Column('double precision')
  pickupLng: number;

  @Column()
  pickupAddress: string;

  // Nearest Google entrance/access-point to pickupLat/Lng (see
  // GoogleMapsService.nearestAccessPoint()) - the actual door, not the
  // building's centroid. Null for the common case: no entrance data
  // for this place, or the passenger dropped a bare map pin rather
  // than confirming a searched place.
  @Column({ type: 'double precision', nullable: true })
  pickupEntranceLat: number | null;

  @Column({ type: 'double precision', nullable: true })
  pickupEntranceLng: number | null;

  // Set when the pickup was resolved against a specific AirportZone
  // (see AirportService.findContainingZone / RidesService.requestRide) -
  // e.g. "Terminal 1 Arrivals". Null for the overwhelming majority of
  // rides, which aren't airport pickups at all.
  @Column({ type: 'varchar', nullable: true })
  pickupZoneName: string | null;

  @Column('double precision')
  dropoffLat: number;

  @Column('double precision')
  dropoffLng: number;

  @Column()
  dropoffAddress: string;

  // Optional intermediate stops as [{lat, lng, address}, ...]
  @Column({ type: 'jsonb', nullable: true })
  stops: { lat: number; lng: number; address: string }[] | null;

  @Column({ type: 'varchar', nullable: true })
  city: string | null;

  @Column({ type: 'double precision', nullable: true })
  estimatedDistanceKm: number | null;

  @Column({ type: 'int', nullable: true })
  estimatedDurationMin: number | null;

  // ---- Fare breakdown ----
  @Column({ type: 'decimal', precision: 10, scale: 2 })
  baseFare: string;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  distanceFare: string;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  timeFare: string;

  @Column({ type: 'decimal', precision: 4, scale: 2, default: 1.0 })
  surgeMultiplier: string;

  @Column({ type: 'decimal', precision: 4, scale: 2, default: 1.0 })
  nightMultiplierApplied: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  airportFee: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  waitingFee: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  cancellationFee: string | null;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  tollFare: string;

   @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  discount: string;

   @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  poolDiscountAmount: string;

  @Column({ type: 'varchar', nullable: true })
  poolGroupId: string | null;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  totalFare: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  tipAmount: string;

  // Generated at request time, shown to the passenger, spoken by the
  // passenger to the driver at pickup — a lightweight anti-fraud check
  // that this is genuinely the matched driver/passenger pair, not
  // someone else flagging down the car.
  @Column({ type: 'varchar', nullable: true })
  verificationPin: string | null;

  @Column({ default: false })
  isPinVerified: boolean;

  // Rate-limits verifyPin() - see RidesService.verifyPin()'s doc comment.
  @Column({ default: 0 })
  pinAttemptCount: number;

  @Column({ default: false })
  usedRealRouting: boolean;

  @Column({ default: false })
  isAirportTrip: boolean;

  // Set at request time if the pickup point fell inside an active
  // RESTRICTED-type geofence (see GeofenceService.checkPoint()) - a
  // no-stopping zone, secure facility, etc. Informational, not
  // blocking: persisted so a dispatcher/support agent investigating
  // an issue later can still see it was flagged, not just surfaced
  // once in the creation response and then lost.
  @Column({ type: 'varchar', nullable: true })
  restrictedZoneWarning: string | null;

  // Informational only — no real flight-tracking integration (see Known
  // gaps). Lets the passenger/driver see what flight a pickup is tied to.
  @Column({ type: 'varchar', nullable: true })
  flightNumber: string | null;

  // Set for a book-ahead ride — the ride sits in SCHEDULED status until a
  // delayed BullMQ job (queued at request time) flips it to SEARCHING and
  // triggers normal dispatch shortly before this time.
  @Column({ type: 'timestamp', nullable: true })
  scheduledAt: Date | null;

  // ---- Commission / driver earnings ----
  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  commissionPercent: string | null;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  commissionAmount: string | null;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  driverEarnings: string | null;

  // True once the driver has actually been credited. For wallet/cash/card
  // this happens synchronously at completion; for bank_transfer it waits
  // for the Paystack webhook to confirm the passenger's payment landed.
  @Column({ default: false })
  earningsSettled: boolean;

  @Column({ type: 'enum', enum: PaymentMethod, default: PaymentMethod.CASH })
  paymentMethod: PaymentMethod;

  @Column({ type: 'int', nullable: true })
  passengerRating: number | null;

  @Column({ type: 'varchar', nullable: true })
  passengerRatingComment: string | null;

  @Column({ type: 'int', nullable: true })
  driverRating: number | null;

  @Column({ type: 'varchar', nullable: true })
  driverRatingComment: string | null;

  @Column({ type: 'enum', enum: CancelledBy, nullable: true })
  cancelledBy: CancelledBy | null;

  @Column({ type: 'varchar', nullable: true })
  cancelReason: string | null;

  // Generated on demand via POST /rides/:id/share — lets the passenger
  // share a read-only, unauthenticated tracking link with someone who
  // doesn't have a Ryda account (a family member waiting for them, etc).
  @Column({ type: 'varchar', nullable: true, unique: true })
  shareToken: string | null;

  @Column({ type: 'timestamp', nullable: true })
  acceptedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  arrivedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  startedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  completedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  cancelledAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
