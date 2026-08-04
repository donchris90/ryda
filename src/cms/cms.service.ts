import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CmsPage } from './entities/cms-page.entity';
import { Announcement } from './entities/announcement.entity';
import { CreateAnnouncementDto, UpsertPageDto } from './dto/cms.dto';

@Injectable()
export class CmsService {
  constructor(
    @InjectRepository(CmsPage)
    private readonly pagesRepo: Repository<CmsPage>,
    @InjectRepository(Announcement)
    private readonly announcementsRepo: Repository<Announcement>,
  ) {}

  // ---- Pages ----

  async getPublishedPage(slug: string): Promise<CmsPage> {
    const page = await this.pagesRepo.findOne({ where: { slug, isPublished: true } });
    if (!page) throw new NotFoundException('Page not found');
    return page;
  }

  async listAllPages(): Promise<CmsPage[]> {
    return this.pagesRepo.find({ order: { slug: 'ASC' } });
  }

  async upsertPage(slug: string, dto: UpsertPageDto): Promise<CmsPage> {
    let page = await this.pagesRepo.findOne({ where: { slug } });
    if (!page) {
      page = this.pagesRepo.create({ slug });
    }
    page.title = dto.title;
    page.content = dto.content;
    if (dto.isPublished !== undefined) page.isPublished = dto.isPublished;
    return this.pagesRepo.save(page);
  }

  // ---- Announcements ----

  async listActiveAnnouncements(): Promise<Announcement[]> {
    const now = new Date();
    return this.announcementsRepo
      .createQueryBuilder('a')
      .where('a.isActive = true')
      .andWhere('(a.startDate IS NULL OR a.startDate <= :now)', { now })
      .andWhere('(a.endDate IS NULL OR a.endDate >= :now)', { now })
      .orderBy('a.createdAt', 'DESC')
      .getMany();
  }

  async listAllAnnouncements(): Promise<Announcement[]> {
    return this.announcementsRepo.find({ order: { createdAt: 'DESC' } });
  }

  async createAnnouncement(dto: CreateAnnouncementDto): Promise<Announcement> {
    const announcement = this.announcementsRepo.create({
      ...dto,
      startDate: dto.startDate ? new Date(dto.startDate) : null,
      endDate: dto.endDate ? new Date(dto.endDate) : null,
    });
    return this.announcementsRepo.save(announcement);
  }

  async setAnnouncementActive(id: string, isActive: boolean): Promise<Announcement> {
    const announcement = await this.announcementsRepo.findOne({ where: { id } });
    if (!announcement) throw new NotFoundException('Announcement not found');
    announcement.isActive = isActive;
    return this.announcementsRepo.save(announcement);
  }
}
