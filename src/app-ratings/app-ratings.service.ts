import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppRating } from './entities/app-rating.entity';
import { SubmitAppRatingDto } from './dto/submit-app-rating.dto';

export interface AppRatingSummary {
  average: number;
  total: number;
  breakdown: Record<1 | 2 | 3 | 4 | 5, number>;
}

@Injectable()
export class AppRatingsService {
  constructor(
    @InjectRepository(AppRating)
    private readonly ratingsRepo: Repository<AppRating>,
  ) {}

  async submit(userId: string, dto: SubmitAppRatingDto): Promise<AppRating> {
    const existing = await this.ratingsRepo.findOne({ where: { userId } });
    if (existing) {
      existing.rating = dto.rating;
      existing.comment = dto.comment ?? null;
      return this.ratingsRepo.save(existing);
    }
    return this.ratingsRepo.save(
      this.ratingsRepo.create({ userId, rating: dto.rating, comment: dto.comment ?? null }),
    );
  }

  async getMine(userId: string): Promise<AppRating | null> {
    return this.ratingsRepo.findOne({ where: { userId } });
  }

  /**
   * A single GROUP BY query rather than fetching every row and
   * reducing in JS — meant to hold up as ratings grow into the
   * thousands (the request's own mockup shows "Total ratings: 3,482"),
   * not just work fine on a handful of test rows.
   */
  async getSummary(): Promise<AppRatingSummary> {
    const rows = await this.ratingsRepo
      .createQueryBuilder('r')
      .select('r.rating', 'rating')
      .addSelect('COUNT(*)', 'count')
      .groupBy('r.rating')
      .getRawMany<{ rating: number; count: string }>();

    const breakdown: AppRatingSummary['breakdown'] = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let total = 0;
    let weightedSum = 0;

    for (const row of rows) {
      const count = parseInt(row.count, 10);
      const rating = row.rating as 1 | 2 | 3 | 4 | 5;
      breakdown[rating] = count;
      total += count;
      weightedSum += rating * count;
    }

    return {
      average: total > 0 ? Math.round((weightedSum / total) * 10) / 10 : 0,
      total,
      breakdown,
    };
  }
}
