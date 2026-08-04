import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FleetCompany } from './entities/fleet-company.entity';
import { FleetStaff } from './entities/fleet-staff.entity';
import { FleetWallet } from './entities/fleet-wallet.entity';
import { FleetTransaction } from './entities/fleet-transaction.entity';
import { FleetPayout } from './entities/fleet-payout.entity';
import { FleetService } from './fleet.service';
import { FleetController } from './fleet.controller';
import { DriversModule } from '../drivers/drivers.module';
import { VehiclesModule } from '../vehicles/vehicles.module';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([FleetCompany, FleetStaff, FleetWallet, FleetTransaction, FleetPayout]),
    DriversModule,
    VehiclesModule,
    PaymentsModule,
  ],
  providers: [FleetService],
  controllers: [FleetController],
  exports: [FleetService],
})
export class FleetModule {}
