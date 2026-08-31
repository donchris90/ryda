import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AdCampaign, AdCampaignStatus } from './entities/ad-campaign.entity';
import { BannerAd, BannerPlacement } from './entities/banner-ad.entity';
import { SponsoredLocation } from './entities/sponsored-location.entity';
import {
  CreateBannerAdDto,
  CreateCampaignDto,
  CreateSponsoredLocationDto,
} from './dto/advertising.dto';
import { haversineDistanceKm } from '../common/utils/geo.util';

@Injectable()
export class AdvertisingService {
  constructor(
    @InjectRepository(AdCampaign)
    private readonly campaignsRepo: Repository<AdCampaign>,
    @InjectRepository(BannerAd)
    private readonly bannersRepo: Repository<BannerAd>,
    @InjectRepository(SponsoredLocation)
    private readonly locationsRepo: Repository<SponsoredLocation>,
  ) {}

  // ---- Campaigns ----

  async createCampaign(dto: CreateCampaignDto): Promise<AdCampaign> {
    return this.campaignsRepo.save(
      this.campaignsRepo.create({
        ...dto,
        budget: dto.budget?.toFixed(2) ?? null,
        startDate: dto.startDate ? new Date(dto.startDate) : null,
        endDate: dto.endDate ? new Date(dto.endDate) : null,
      }),
    );
  }

  async listCampaigns(): Promise<AdCampaign[]> {
    return this.campaignsRepo.find({ order: { createdAt: 'DESC' } });
  }

  async setCampaignStatus(id: string, status: AdCampaignStatus): Promise<AdCampaign> {
    const campaign = await this.campaignsRepo.findOne({ where: { id } });
    if (!campaign) throw new NotFoundException('Campaign not found');
    campaign.status = status;
    return this.campaignsRepo.save(campaign);
  }

  /**
   * Rolls up the banners and sponsored locations tagged with this
   * campaignId. There is no spend-tracking anywhere in this module — only
   * a `budget` figure set at campaign creation — so this deliberately does
   * NOT report a "spend" number; that would have to be invented rather
   * than computed. CTR is derived straight from stored impressions/clicks.
   */
  async getCampaignAnalytics(id: string): Promise<{
    campaign: AdCampaign;
    banners: { total: number; impressions: number; clicks: number; ctr: number };
    sponsoredLocations: { total: number; impressions: number };
  }> {
    const campaign = await this.campaignsRepo.findOne({ where: { id } });
    if (!campaign) throw new NotFoundException('Campaign not found');

    const [banners, locations] = await Promise.all([
      this.bannersRepo.find({ where: { campaignId: id } }),
      this.locationsRepo.find({ where: { campaignId: id } }),
    ]);

    const impressions = banners.reduce((sum, b) => sum + b.impressions, 0);
    const clicks = banners.reduce((sum, b) => sum + b.clicks, 0);

    return {
      campaign,
      banners: {
        total: banners.length,
        impressions,
        clicks,
        ctr: impressions > 0 ? Math.round((clicks / impressions) * 10000) / 100 : 0,
      },
      sponsoredLocations: {
        total: locations.length,
        impressions: locations.reduce((sum, l) => sum + l.impressions, 0),
      },
    };
  }

  // ---- Banner ads ----

  async createBanner(dto: CreateBannerAdDto): Promise<BannerAd> {
    return this.bannersRepo.save(
      this.bannersRepo.create({
        ...dto,
        startDate: dto.startDate ? new Date(dto.startDate) : null,
        endDate: dto.endDate ? new Date(dto.endDate) : null,
      }),
    );
  }

  async listAllBanners(): Promise<BannerAd[]> {
    return this.bannersRepo.find({ order: { createdAt: 'DESC' } });
  }

  /** Active banners for a placement, within their date window if one is set. */
  async listActiveBanners(placement: BannerPlacement): Promise<BannerAd[]> {
    const now = new Date();
    return this.bannersRepo
      .createQueryBuilder('b')
      .where('b.placement = :placement', { placement })
      .andWhere('b.isActive = true')
      .andWhere('(b.startDate IS NULL OR b.startDate <= :now)', { now })
      .andWhere('(b.endDate IS NULL OR b.endDate >= :now)', { now })
      .getMany();
  }

  async recordImpression(id: string): Promise<void> {
    await this.bannersRepo.increment({ id }, 'impressions', 1);
  }

  /** Records the click and returns the click-through URL. */
  async recordClick(id: string): Promise<string> {
    const banner = await this.bannersRepo.findOne({ where: { id } });
    if (!banner) throw new NotFoundException('Banner not found');
    await this.bannersRepo.increment({ id }, 'clicks', 1);
    return banner.targetUrl;
  }

  async setBannerActive(id: string, isActive: boolean): Promise<BannerAd> {
    const banner = await this.bannersRepo.findOne({ where: { id } });
    if (!banner) throw new NotFoundException('Banner not found');
    banner.isActive = isActive;
    return this.bannersRepo.save(banner);
  }

  // ---- Sponsored locations ----

  async createSponsoredLocation(dto: CreateSponsoredLocationDto): Promise<SponsoredLocation> {
    return this.locationsRepo.save(this.locationsRepo.create(dto));
  }

  async listAllSponsoredLocations(): Promise<SponsoredLocation[]> {
    return this.locationsRepo.find({ order: { createdAt: 'DESC' } });
  }

  async setSponsoredLocationActive(id: string, isActive: boolean): Promise<SponsoredLocation> {
    const location = await this.locationsRepo.findOne({ where: { id } });
    if (!location) throw new NotFoundException('Sponsored location not found');
    location.isActive = isActive;
    return this.locationsRepo.save(location);
  }

  /** Sponsored pins within their own radius of the given map point — verified with real distance math, not a bounding box. */
  async findNearbySponsoredLocations(lat: number, lng: number): Promise<SponsoredLocation[]> {
    const active = await this.locationsRepo.find({ where: { isActive: true } });
    const nearby = active.filter(
      (loc) => haversineDistanceKm(lat, lng, loc.lat, loc.lng) <= loc.radiusKm,
    );

    // Impressions count each time a pin actually shows on someone's map.
    await Promise.all(nearby.map((loc) => this.locationsRepo.increment({ id: loc.id }, 'impressions', 1)));

    return nearby;
  }
}
