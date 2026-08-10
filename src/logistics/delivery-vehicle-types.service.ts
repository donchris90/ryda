import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DeliveryVehicleTypeConfig } from './entities/delivery-vehicle-type-config.entity';
import { DeliveryVehicleType } from './entities/delivery-order.entity';
import { UpsertVehicleTypeConfigDto } from './dto/vehicle-type-config.dto';

// Reasonable starting values, deliberately matching the shape of the
// request's own example table — explicitly example numbers, not
// prescribed business rules. Seeded once if the table is empty, then
// entirely admin-editable from there; this seed never runs again once
// any config rows exist.
const DEFAULT_CONFIGS: Record<DeliveryVehicleType, Omit<UpsertVehicleTypeConfigDto, 'isActive'>> = {
  [DeliveryVehicleType.BIKE]: { baseFare: 300, perKm: 80, perKg: 30, minimumFare: 500, maxWeightKg: 15, capacityDescription: 'Small parcels, documents' },
  [DeliveryVehicleType.KEKE]: { baseFare: 500, perKm: 100, perKg: 40, minimumFare: 700, maxWeightKg: 50, capacityDescription: 'Medium boxes, groceries' },
  [DeliveryVehicleType.CAR]: { baseFare: 700, perKm: 120, perKg: 50, minimumFare: 1000, maxWeightKg: 100, capacityDescription: 'Several boxes, appliances' },
  [DeliveryVehicleType.VAN]: { baseFare: 1500, perKm: 180, perKg: 70, minimumFare: 2000, maxWeightKg: 500, capacityDescription: 'Furniture, bulk goods' },
  [DeliveryVehicleType.PICKUP]: { baseFare: 2500, perKm: 220, perKg: 90, minimumFare: 3000, maxWeightKg: 1000, capacityDescription: 'Large furniture, equipment' },
  [DeliveryVehicleType.TRUCK]: { baseFare: 5000, perKm: 350, perKg: 120, minimumFare: 6000, maxWeightKg: 5000, capacityDescription: 'Full moves, freight' },
};

@Injectable()
export class DeliveryVehicleTypesService implements OnModuleInit {
  constructor(
    @InjectRepository(DeliveryVehicleTypeConfig)
    private readonly configRepo: Repository<DeliveryVehicleTypeConfig>,
  ) {}

  async onModuleInit(): Promise<void> {
    const existingCount = await this.configRepo.count();
    if (existingCount > 0) return;

    await this.configRepo.save(
      Object.entries(DEFAULT_CONFIGS).map(([vehicleType, cfg]) =>
        this.configRepo.create({
          vehicleType: vehicleType as DeliveryVehicleType,
          baseFare: cfg.baseFare.toFixed(2),
          perKm: cfg.perKm.toFixed(2),
          perKg: cfg.perKg.toFixed(2),
          minimumFare: cfg.minimumFare.toFixed(2),
          maxWeightKg: cfg.maxWeightKg.toFixed(2),
          capacityDescription: cfg.capacityDescription,
          isActive: true,
        }),
      ),
    );
  }

  async listAll(): Promise<DeliveryVehicleTypeConfig[]> {
    return this.configRepo.find({ order: { maxWeightKg: 'ASC' } });
  }

  async listActive(): Promise<DeliveryVehicleTypeConfig[]> {
    return this.configRepo.find({ where: { isActive: true }, order: { maxWeightKg: 'ASC' } });
  }

  async getByType(vehicleType: DeliveryVehicleType): Promise<DeliveryVehicleTypeConfig> {
    const config = await this.configRepo.findOne({ where: { vehicleType } });
    if (!config) throw new NotFoundException(`No pricing configured for vehicle type "${vehicleType}"`);
    return config;
  }

  async upsert(vehicleType: DeliveryVehicleType, dto: UpsertVehicleTypeConfigDto): Promise<DeliveryVehicleTypeConfig> {
    const existing = await this.configRepo.findOne({ where: { vehicleType } });
    const values = {
      baseFare: dto.baseFare.toFixed(2),
      perKm: dto.perKm.toFixed(2),
      perKg: dto.perKg.toFixed(2),
      minimumFare: dto.minimumFare.toFixed(2),
      maxWeightKg: dto.maxWeightKg.toFixed(2),
      capacityDescription: dto.capacityDescription ?? null,
      isActive: dto.isActive ?? true,
    };

    if (existing) {
      Object.assign(existing, values);
      return this.configRepo.save(existing);
    }
    return this.configRepo.save(this.configRepo.create({ vehicleType, ...values }));
  }
}
