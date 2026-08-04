import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CorporateAccount } from './entities/corporate-account.entity';
import { CorporateEmployee } from './entities/corporate-employee.entity';
import { CorporateTransaction } from './entities/corporate-transaction.entity';
import { CorporateService } from './corporate.service';
import { CorporateController } from './corporate.controller';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([CorporateAccount, CorporateEmployee, CorporateTransaction]),
    UsersModule,
  ],
  providers: [CorporateService],
  controllers: [CorporateController],
  exports: [CorporateService],
})
export class CorporateModule {}
