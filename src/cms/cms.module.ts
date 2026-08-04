import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CmsPage } from './entities/cms-page.entity';
import { Announcement } from './entities/announcement.entity';
import { CmsService } from './cms.service';
import { CmsController } from './cms.controller';

@Module({
  imports: [TypeOrmModule.forFeature([CmsPage, Announcement])],
  providers: [CmsService],
  controllers: [CmsController],
  exports: [CmsService],
})
export class CmsModule {}
