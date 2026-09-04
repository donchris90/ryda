import { Injectable } from '@nestjs/common';
import { FraudFlagStatus } from '../fraud/entities/fraud-flag.entity';
import { RiskEngineService, RiskBand } from '../fraud/risk-engine.service';

export interface RiskScoreResult {
  userId: string;
  score: number; // 0-100
  level: 'low' | 'medium' | 'high' | 'critical';
  openFlagCount: number;
  contributingFlags: { type: string; severity: string }[];
}

const BAND_TO_LEVEL: Record<RiskBand, RiskScoreResult['level']> = {
  [RiskBand.LOW]: 'low',
  [RiskBand.MEDIUM]: 'medium',
  [RiskBand.HIGH]: 'high',
  [RiskBand.CRITICAL]: 'critical',
};

/**
 * Thin adapter over RiskEngineService (see fraud/risk-engine.service.ts
 * for the actual scoring logic, now the single source of truth) -
 * kept so the existing GET /ai/fraud-risk/:userId endpoint's response
 * shape doesn't change for whatever already calls it. score here is
 * clamped to 0-100 for that same backward-compatibility reason (the
 * underlying engine's score is unbounded, since severity weights and
 * band thresholds are independently admin-configurable and could be
 * set arbitrarily high).
 */
@Injectable()
export class FraudAiService {
  constructor(private readonly riskEngineService: RiskEngineService) {}

  async getRiskScore(userId: string): Promise<RiskScoreResult> {
    const assessment = await this.riskEngineService.assess(userId);

    return {
      userId,
      score: Math.min(100, Math.round(assessment.score)),
      level: BAND_TO_LEVEL[assessment.band],
      openFlagCount: assessment.reasons.filter((r) => r.status === FraudFlagStatus.OPEN).length,
      contributingFlags: assessment.reasons.map((r) => ({ type: r.type, severity: r.severity })),
    };
  }
}
