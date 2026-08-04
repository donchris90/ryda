import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FraudFlag, FraudFlagSeverity, FraudFlagStatus } from '../fraud/entities/fraud-flag.entity';

export interface RiskScoreResult {
  userId: string;
  score: number; // 0-100
  level: 'low' | 'medium' | 'high' | 'critical';
  openFlagCount: number;
  contributingFlags: { type: string; severity: string }[];
}

const SEVERITY_WEIGHT: Record<FraudFlagSeverity, number> = {
  [FraudFlagSeverity.LOW]: 10,
  [FraudFlagSeverity.MEDIUM]: 25,
  [FraudFlagSeverity.HIGH]: 45,
};

/**
 * Turns FraudService's individual flags into one composite score per user
 * — makes "should we look at this account" a single number instead of
 * making an admin manually weigh several separate flags. Dismissed flags
 * don't contribute; reviewed-but-not-dismissed ones count at half weight
 * (a human already looked and didn't clear it, but didn't escalate either).
 */
@Injectable()
export class FraudAiService {
  constructor(
    @InjectRepository(FraudFlag)
    private readonly flagsRepo: Repository<FraudFlag>,
  ) {}

  async getRiskScore(userId: string): Promise<RiskScoreResult> {
    const flags = await this.flagsRepo.find({ where: { userId } });
    const relevant = flags.filter((f) => f.status !== FraudFlagStatus.DISMISSED);

    let rawScore = 0;
    for (const flag of relevant) {
      const weight = SEVERITY_WEIGHT[flag.severity];
      rawScore += flag.status === FraudFlagStatus.REVIEWED ? weight * 0.5 : weight;
    }

    const score = Math.min(100, Math.round(rawScore));
    const level = score >= 70 ? 'critical' : score >= 40 ? 'high' : score >= 15 ? 'medium' : 'low';

    return {
      userId,
      score,
      level,
      openFlagCount: relevant.filter((f) => f.status === FraudFlagStatus.OPEN).length,
      contributingFlags: relevant.map((f) => ({ type: f.type, severity: f.severity })),
    };
  }
}
