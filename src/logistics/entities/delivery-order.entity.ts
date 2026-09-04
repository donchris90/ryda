import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { PaymentMethod } from '../../common/enums/ride.enum';

export enum DeliveryVehicleType {
  BIKE = 'bike',
  KEKE = 'keke',
  CAR = 'car',
  VAN = 'van',
  PICKUP = 'pickup',
  TRUCK = 'truck',
}

export enum DeliveryCategory {
  PARCEL = 'parcel',
  FOOD = 'food',
  GROCERY = 'grocery',
  PHARMACY = 'pharmacy',
  COURIER = 'courier',
}

export enum DeliveryStatus {
  REQUESTED = 'requested',
  SEARCHING = 'searching',
  ACCEPTED = 'accepted',
  PICKUP_ARRIVED = 'pickup_arrived',
  PICKED_UP = 'picked_up',
  IN_TRANSIT = 'in_transit',
  DELIVERED = 'delivered',
  CANCELLED = 'cancelled',
  FAILED = 'failed',
}

// Set once, at delivery completion, by comparing codCollectedAmount
// against codAmount - never set retroactively, so it always reflects
// what actually happened at handoff, not a later admin adjustment
// (that's what codReconciledAt is for).
export enum CodCollectionStatus {
  COLLECTED = 'collected', // collected amount >= expected
  PARTIAL = 'partial', // collected something, but less than expected
  FAILED = 'failed', // collected nothing at all
}

export enum DeliveryCancelledBy {
  CUSTOMER = 'customer',
  DRIVER = 'driver',
  SYSTEM = 'system',
}

/**
 * OPTION A (AUTO) vs OPTION B (choose a courier) — the same product
 * distinction rides already offer. Persisted on the order (not just a
 * request-time flag) because it also governs whether requestDelivery()
 * broadcasts to every eligible driver immediately (AUTO) or waits for
 * the passenger to pick one via selectCourier() (MANUAL) — a later
 * reader of this row (support, admin diagnostics, a driver wondering
 * why they were never notified) needs to be able to tell which
 * happened.
 */
export enum DeliveryDispatchMode {
  AUTO = 'auto',
  MANUAL = 'manual',
}

@Entity('delivery_orders')
export class DeliveryOrder {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  customerId: string;

  @Index()
  @Column({ type: 'varchar', nullable: true })
  driverId: string | null;

  @Column({ type: 'varchar', nullable: true })
  vehicleId: string | null;

  @Column({ type: 'enum', enum: DeliveryCategory })
  category: DeliveryCategory;

  // Default of CAR protects any existing production rows from a
  // NOT NULL failure when this column is added via synchronize - new
  // deliveries always specify one explicitly via the DTO.
  @Column({
    type: 'enum',
    enum: DeliveryVehicleType,
    default: DeliveryVehicleType.CAR,
  })
  vehicleType: DeliveryVehicleType;

  // Default of AUTO protects existing production rows the same way
  // vehicleType's default does above — every delivery ever created
  // before this column existed was, in effect, AUTO (broadcast to
  // everyone), since MANUAL/selectCourier() didn't exist yet.
  @Column({
    type: 'enum',
    enum: DeliveryDispatchMode,
    default: DeliveryDispatchMode.AUTO,
  })
  dispatchMode: DeliveryDispatchMode;

  @Index()
  @Column({
    type: 'enum',
    enum: DeliveryStatus,
    default: DeliveryStatus.REQUESTED,
  })
  status: DeliveryStatus;

  // ---- Pickup ----
  @Column('double precision')
  pickupLat: number;

  @Column('double precision')
  pickupLng: number;

  @Column()
  pickupAddress: string;

  @Column()
  pickupContactName: string;

  @Column()
  pickupContactPhone: string;

  // ---- Dropoff ----
  @Column('double precision')
  dropoffLat: number;

  @Column('double precision')
  dropoffLng: number;

  @Column()
  dropoffAddress: string;

  @Column()
  dropoffContactName: string;

  @Column()
  dropoffContactPhone: string;

  // ---- Item details ----
  @Column()
  itemDescription: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  itemValue: string | null;

  @Column({ type: 'decimal', precision: 6, scale: 2, nullable: true })
  weightKg: string | null;

  @Column({ default: false })
  requiresSignature: boolean;

  // Cash on delivery — the customer pays the driver directly on handoff,
  // same settlement shape as a ride's CASH payment method.
  @Column({ default: false })
  isCod: boolean;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  codAmount: string | null;

  // What the driver actually reported collecting at handoff - can
  // differ from codAmount above (customer paid less, refused, or the
  // driver waived part of it). Null until delivery completes.
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  codCollectedAmount: string | null;

  @Column({ type: 'enum', enum: CodCollectionStatus, nullable: true })
  codCollectionStatus: CodCollectionStatus | null;

  // Set once an admin has reconciled a PARTIAL/FAILED collection
  // against the driver's own responsibility for the shortfall (see
  // LogisticsService.markDelivered()'s own comment on courier
  // responsibility) - null means still outstanding.
  @Column({ type: 'timestamp', nullable: true })
  codReconciledAt: Date | null;

  @Column({ type: 'varchar', nullable: true })
  city: string | null;

  @Column({ type: 'double precision', nullable: true })
  estimatedDistanceKm: number | null;

  // ---- Fare ----
  @Column({ type: 'decimal', precision: 10, scale: 2 })
  baseFare: string;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  distanceFare: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  weightFare: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  discount: string;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  totalFare: string;

  @Column({ type: 'enum', enum: PaymentMethod, default: PaymentMethod.CASH })
  paymentMethod: PaymentMethod;

  // ---- Commission / driver earnings ----
  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  commissionPercent: string | null;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  commissionAmount: string | null;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  driverEarnings: string | null;

  @Column({ default: false })
  earningsSettled: boolean;

  @Column({ type: 'enum', enum: DeliveryCancelledBy, nullable: true })
  cancelledBy: DeliveryCancelledBy | null;

  @Column({ type: 'varchar', nullable: true })
  cancelReason: string | null;

  @Column({ type: 'timestamp', nullable: true })
  acceptedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  pickedUpAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  deliveredAt: Date | null;

  // ---- Proof of delivery ----
  // Uploaded via the existing generic POST /storage/upload/:folder
  // endpoint (same pattern as support-ticket attachments) - these
  // just link the resulting URLs to the order. Photo is the common
  // case for most deliveries; signature is only actually captured
  // when requiresSignature was set at order time (enforced in
  // LogisticsService.markDelivered(), not just left optional here).
  @Column({ type: 'varchar', nullable: true })
  proofPhotoUrl: string | null;

  @Column({ type: 'varchar', nullable: true })
  proofSignatureUrl: string | null;

  // Who actually accepted the package, in their own words/spelling -
  // not assumed to be dropoffContactName, since a neighbour, doorman,
  // or someone else entirely often signs for a delivery instead of
  // the named recipient.
  @Column({ type: 'varchar', nullable: true })
  proofRecipientName: string | null;

  // Captured from the driver's device at the moment of marking
  // delivered - independent evidence of where the handoff actually
  // happened, not just what the order's own dropoff coordinates say
  // it was supposed to be.
  @Column({ type: 'double precision', nullable: true })
  proofDeliveryLat: number | null;

  @Column({ type: 'double precision', nullable: true })
  proofDeliveryLng: number | null;

  @Column({ type: 'timestamp', nullable: true })
  cancelledAt: Date | null;

  @Column({ type: 'int', nullable: true })
  driverRating: number | null;

  @Column({ type: 'varchar', nullable: true })
  driverRatingComment: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
