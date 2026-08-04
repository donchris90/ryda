import { Module } from '@nestjs/common';
import { PermissionsController } from './permissions/permissions.controller';

@Module({
  controllers: [PermissionsController],
})
export class CommonModule {}
