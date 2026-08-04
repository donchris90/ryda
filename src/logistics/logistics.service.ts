import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  DeliveryOrder,
  DeliveryCancelledBy,
  DeliveryStatus,
} from './entities/delivery-order.entity';
import { EstimateDeliveryDto, RequestDeliveryDto, CancelDeliveryDto } from './dto/logistics.dto';
import { PaymentMethod } from '../common/enums/ride.enum';
import { TransactionCategory } from '../common/enums/transaction.enum';
import { DriverApprovalStatus, DriverAvailability } from '../common/enums/driver-status.enum';
import { haversineDistanceKm } from '../common/utils/geo.util';
import { DriversService } from '../drivers/drivers.service';
import { VehiclesService } from '../vehicles/vehicles.service';
import { WalletsService } from '../wallets/wallets.service';
import { CommissionService } from '../commission/commission.service';
import { CorporateService } from '../corporate/corporate.service';
import { FleetService } from '../fleet/fleet.service';
import { UsersService } from '../users/users.service';
import { PaymentsService } from '../payments/payments.service';
import { PaymentStatus } from '../payments/entities/payment-record.entity';
import { ReconciliationService } from '../reconciliation/reconciliation.service';

export interface DeliveryFareBreakdown {
  baseFare: number;
  distanceFare: number;
  weightFare: number;
  totalFare: number;
  estimatedDistanceKm: number;
  currency: string;
}

@Injectable()
export class LogisticsService {
  constructor(
    @InjectRepository(DeliveryOrder)
    private readonly ordersRepo: Repository<DeliveryOrder>,
    private readonly config: ConfigService,
    private readonly driversService: DriversService,
    private readonly vehiclesService: VehiclesService,
    private readonly walletsService: WalletsService,
    private readonly commissionService: CommissionService,
    private readonly corporateService: CorporateService,
    private readonly fleetService: FleetService,
    private readonly usersService: UsersService,
    private readonly paymentsService: PaymentsService,
    private readonly reconciliationService: ReconciliationService,
    private readonly events: EventEmitter2,
  ) {}

  estimateFare(dto: EstimateDeliveryDto): DeliveryFareBreakdown {
    const distanceKm = haversineDistanceKm(dto.pickupLat, dto.pickupLng, dto.dropoffLat, dto.dropoffLng);

    const baseFare = this.config.get<number>('logistics.baseFare')!;
    const perKm = this.config.get<number>('logistics.perKm')!;
    const perKg = this.config.get<number>('logistics.perKg')!;
    const minimumFare = this.config.get<number>('logistics.minimumFare')!;
    const currency = this.config.get<string>('pricing.currency')!;

    const distanceFare = distanceKm * perKm;
    const weightFare = (dto.weightKg ?? 0) * perKg;
    const totalFare = Math.max(baseFare + distanceFare + weightFare, minimumFare);

    return {
      baseFare: this.round(baseFare),
      distanceFare: this.round(distanceFare),
      weightFare: this.round(weightFare),
      totalFare: this.round(totalFare),
      estimatedDistanceKm: this.round(distanceKm),
      currency,
    };
  }

  async requestDelivery(customerId: string, dto: RequestDeliveryDto): Promise<DeliveryOrder> {
    const breakdown = this.estimateFare(dto);
    const paymentMethod = dto.paymentMethod ?? PaymentMethod.CASH;

    if (paymentMethod === PaymentMethod.CORPORATE) {
      const account = await this.corporateService.getAccountForEmployee(customerId);
      if (!account) {
        throw new BadRequestException('You are not linked to an active corporate account');
      }
    }
    if (dto.isCod && paymentMethod !== PaymentMethod.CASH) {
      throw new BadRequestException('Cash on delivery requires paymentMethod=cash');
    }

    const order = this.ordersRepo.create({
      customerId,
      category: dto.category,
      status: DeliveryStatus.SEARCHING,
      pickupLat: dto.pickupLat,
      pickupLng: dto.pickupLng,
      pickupAddress: dto.pickupAddress,
      pickupContactName: dto.pickupContactName,
      pickupContactPhone: dto.pickupContactPhone,
      dropoffLat: dto.dropoffLat,
      dropoffLng: dto.dropoffLng,
      dropoffAddress: dto.dropoffAddress,
      dropoffContactName: dto.dropoffContactName,
      dropoffContactPhone: dto.dropoffContactPhone,
      itemDescription: dto.itemDescription,
      itemValue: dto.itemValue?.toFixed(2) ?? null,
      weightKg: dto.weightKg?.toFixed(2) ?? null,
      requiresSignature: !!dto.requiresSignature,
      isCod: !!dto.isCod,
      codAmount: dto.codAmount?.toFixed(2) ?? null,
      city: dto.city ?? null,
      estimatedDistanceKm: breakdown.estimatedDistanceKm,
      baseFare: breakdown.baseFare.toFixed(2),
      distanceFare: breakdown.distanceFare.toFixed(2),
      weightFare: breakdown.weightFare.toFixed(2),
      totalFare: breakdown.totalFare.toFixed(2),
      paymentMethod,
    });

    return this.ordersRepo.save(order);
  }

  async findById(id: string): Promise<DeliveryOrder> {
    const order = await this.ordersRepo.findOne({ where: { id } });
    if (!order) throw new NotFoundException('Delivery order not found');
    return order;
  }

  async findForCustomer(customerId: string): Promise<DeliveryOrder[]> {
    return this.ordersRepo.find({ where: { customerId }, order: { createdAt: 'DESC' } });
  }

  async findForDriver(driverId: string): Promise<DeliveryOrder[]> {
    return this.ordersRepo.find({ where: { driverId }, order: { createdAt: 'DESC' } });
  }

  async acceptDelivery(orderId: string, driverUserId: string): Promise<DeliveryOrder> {
    const order = await this.findById(orderId);
    if (order.status !== DeliveryStatus.SEARCHING && order.status !== DeliveryStatus.REQUESTED) {
      throw new BadRequestException(`Delivery cannot be accepted from status ${order.status}`);
    }

    const driverProfile = await this.driversService.findByUserId(driverUserId);
    if (driverProfile.approvalStatus !== DriverApprovalStatus.APPROVED) {
      throw new ForbiddenException('Driver is not approved');
    }
    if (driverProfile.availability !== DriverAvailability.ONLINE) {
      throw new BadRequestException('Driver must be online to accept deliveries');
    }

    order.driverId = driverUserId;
    order.vehicleId = driverProfile.activeVehicleId;
    order.status = DeliveryStatus.ACCEPTED;
    order.acceptedAt = new Date();
    await this.driversService.setAvailability(driverUserId, DriverAvailability.ON_TRIP);

    return this.ordersRepo.save(order);
  }

  async markPickupArrived(orderId: string, driverUserId: string): Promise<DeliveryOrder> {
    const order = await this.getOwnedByDriver(orderId, driverUserId);
    if (order.status !== DeliveryStatus.ACCEPTED) {
      throw new BadRequestException('Delivery must be accepted before marking pickup arrival');
    }
    order.status = DeliveryStatus.PICKUP_ARRIVED;
    return this.ordersRepo.save(order);
  }

  async markPickedUp(orderId: string, driverUserId: string): Promise<DeliveryOrder> {
    const order = await this.getOwnedByDriver(orderId, driverUserId);
    if (order.status !== DeliveryStatus.PICKUP_ARRIVED && order.status !== DeliveryStatus.ACCEPTED) {
      throw new BadRequestException('Delivery must be accepted/at pickup before marking picked up');
    }
    order.status = DeliveryStatus.PICKED_UP;
    order.pickedUpAt = new Date();
    return this.ordersRepo.save(order);
  }

  async markInTransit(orderId: string, driverUserId: string): Promise<DeliveryOrder> {
    const order = await this.getOwnedByDriver(orderId, driverUserId);
    if (order.status !== DeliveryStatus.PICKED_UP) {
      throw new BadRequestException('Delivery must be picked up before marking in transit');
    }
    order.status = DeliveryStatus.IN_TRANSIT;
    return this.ordersRepo.save(order);
  }

  /**
   * Marks the order delivered and settles payment — same shape as
   * RidesService.completeRide: wallet/cash/card/corporate all supported,
   * COD is a variant of cash (customer pays driver directly, driver owes
   * platform commission out of their own wallet/fleet wallet).
   */
  async markDelivered(orderId: string, driverUserId: string): Promise<DeliveryOrder> {
    const order = await this.getOwnedByDriver(orderId, driverUserId);
    if (order.status !== DeliveryStatus.IN_TRANSIT && order.status !== DeliveryStatus.PICKED_UP) {
      throw new BadRequestException('Delivery must be picked up/in transit to complete');
    }

    const driverProfile = await this.driversService.findByUserId(driverUserId);
    const vehicleCategory = driverProfile.activeVehicleId
      ? (await this.vehiclesService.findById(driverProfile.activeVehicleId)).category
      : undefined;

    const commissionPercent =
      driverProfile.commissionOverridePercent != null
        ? parseFloat(driverProfile.commissionOverridePercent)
        : await this.commissionService.resolveCommissionPercent({
            driverLevel: driverProfile.level,
            vehicleCategory,
            city: order.city ?? undefined,
          });

    const totalFare = parseFloat(order.totalFare);
    const commissionAmount = this.round(totalFare * (commissionPercent / 100));
    const driverEarnings = this.round(totalFare - commissionAmount);

    order.status = DeliveryStatus.DELIVERED;
    order.deliveredAt = new Date();
    order.commissionPercent = commissionPercent.toFixed(2);
    order.commissionAmount = commissionAmount.toFixed(2);
    order.driverEarnings = driverEarnings.toFixed(2);
    await this.ordersRepo.save(order);

    if (order.paymentMethod === PaymentMethod.WALLET) {
      const customerWallet = await this.walletsService.getByUserId(order.customerId);
      await this.walletsService.debit(
        customerWallet.id,
        totalFare,
        TransactionCategory.DELIVERY_PAYMENT,
        order.id,
        `Delivery payment for order ${order.id}`,
      );
      await this.creditDriverEarnings(order, driverProfile, driverEarnings, commissionPercent);
    } else if (order.paymentMethod === PaymentMethod.CASH) {
      // COD or plain cash — either way the driver collected cash directly,
      // so only the commission owed is debited from them (or their fleet).
      // Falls back to a tracked reconciliation debt (auto-settles on the
      // next wallet credit) rather than blocking delivery completion if
      // the balance can't cover it right now — same pattern as rides.
      if (driverProfile.fleetCompanyId) {
        try {
          await this.fleetService.debitFleetCommission(driverProfile.fleetCompanyId, commissionAmount, order.id);
        } catch {
          await this.reconciliationService.recordDebt(null, driverProfile.fleetCompanyId, order.id, commissionAmount);
        }
      } else {
        const driverWallet = await this.walletsService.getByUserId(driverUserId);
        try {
          await this.walletsService.debit(
            driverWallet.id,
            commissionAmount,
            TransactionCategory.COMMISSION,
            order.id,
            `Commission owed on delivery ${order.id} (${commissionPercent}%)`,
          );
        } catch {
          await this.reconciliationService.recordDebt(driverUserId, null, order.id, commissionAmount);
        }
      }
      order.earningsSettled = true;
      await this.ordersRepo.save(order);
    } else if (order.paymentMethod === PaymentMethod.CARD) {
      const customer = await this.usersService.findById(order.customerId);
      if (!customer.email) {
        throw new BadRequestException('Add an email to your account before paying by card');
      }
      const payment = await this.paymentsService.chargeSavedCard(
        order.id,
        order.customerId,
        customer.email,
        totalFare,
      );
      if (payment.status !== PaymentStatus.SUCCESS) {
        throw new BadRequestException(payment.failureReason ?? 'Card payment failed');
      }
      await this.creditDriverEarnings(order, driverProfile, driverEarnings, commissionPercent);
    } else if (order.paymentMethod === PaymentMethod.CORPORATE) {
      const account = await this.corporateService.getAccountForEmployee(order.customerId);
      if (!account) throw new BadRequestException('Customer is not linked to a corporate account');
      await this.corporateService.debitForRide(account.id, totalFare, order.id);
      await this.creditDriverEarnings(order, driverProfile, driverEarnings, commissionPercent);
    }

    await this.driversService.recordTripOutcome(driverProfile.id, 'completed');
    await this.driversService.setAvailability(driverUserId, DriverAvailability.ONLINE);

    this.events.emit('delivery.delivered', {
      customerId: order.customerId,
      driverId: driverUserId,
      totalFare: order.totalFare,
    });

    return order;
  }

  async cancelDelivery(
    orderId: string,
    actorUserId: string,
    cancelledBy: DeliveryCancelledBy,
    dto: CancelDeliveryDto,
  ): Promise<DeliveryOrder> {
    const order = await this.findById(orderId);

    if (cancelledBy === DeliveryCancelledBy.CUSTOMER && order.customerId !== actorUserId) {
      throw new ForbiddenException('Not your delivery');
    }
    if (cancelledBy === DeliveryCancelledBy.DRIVER && order.driverId !== actorUserId) {
      throw new ForbiddenException('Not your delivery');
    }
    if (order.status === DeliveryStatus.DELIVERED || order.status === DeliveryStatus.CANCELLED) {
      throw new BadRequestException(`Delivery cannot be cancelled from status ${order.status}`);
    }

    order.status = DeliveryStatus.CANCELLED;
    order.cancelledAt = new Date();
    order.cancelledBy = cancelledBy;
    order.cancelReason = dto.reason ?? null;
    await this.ordersRepo.save(order);

    if (order.driverId) {
      const driverProfile = await this.driversService.findByUserId(order.driverId);
      await this.driversService.recordTripOutcome(driverProfile.id, 'cancelled');
      await this.driversService.setAvailability(order.driverId, DriverAvailability.ONLINE);
    }

    const notifyUserId =
      cancelledBy === DeliveryCancelledBy.CUSTOMER ? order.driverId : order.customerId;
    if (notifyUserId) {
      this.events.emit('delivery.cancelled', { notifyUserId, reason: order.cancelReason });
    }

    return order;
  }

  private async creditDriverEarnings(
    order: DeliveryOrder,
    driverProfile: { userId: string; fleetCompanyId: string | null },
    driverEarnings: number,
    commissionPercent: number,
  ): Promise<void> {
    if (driverProfile.fleetCompanyId) {
      await this.fleetService.creditForRideEarning(driverProfile.fleetCompanyId, driverEarnings, order.id);
    } else {
      const driverWallet = await this.walletsService.getByUserId(driverProfile.userId);
      await this.walletsService.credit(
        driverWallet.id,
        driverEarnings,
        TransactionCategory.DELIVERY_EARNING,
        order.id,
        `Earnings for delivery ${order.id} (commission ${commissionPercent}%)`,
      );
    }
    order.earningsSettled = true;
    await this.ordersRepo.save(order);
  }

  private async getOwnedByDriver(orderId: string, driverUserId: string): Promise<DeliveryOrder> {
    const order = await this.findById(orderId);
    if (order.driverId !== driverUserId) {
      throw new ForbiddenException('Not your delivery');
    }
    return order;
  }

  private round(value: number): number {
    return Math.round(value * 100) / 100;
  }
}
