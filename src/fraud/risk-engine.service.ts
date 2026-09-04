import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, Repository } from 'typeorm';
import { FraudFlag, FraudFlagSeverity, FraudFlagStatus } from './entities/fraud-flag.entity';
import { SystemSettingsService, SETTING_KEYS } from '../settings/settings.service';

export enum RiskBand {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

export interface RiskReason {
  flagId: string;
  type: string;
  severity: FraudFlagSeverity;
  status: FraudFlagStatus;
  weight: number;
  occurredAt: Date;
  details: Record<string, unknown> | null;
}

export interface RiskAssessment {
  userId: string;
  score: number;
  band: RiskBand;
  reasons: RiskReason[];
}

const DEFAULT_WEIGHTS: Record<FraudFlagSeverity, number> = {
  [FraudFlagSeverity.LOW]: 5,
  [FraudFlagSeverity.MEDIUM]: 15,
  [FraudFlagSeverity.HIGH]: 35,
  [FraudFlagSeverity.CRITICAL]: 70,
};

/**
 * Turns the flat log of individual fraud flags (each one a single
 * heuristic firing) into a single explainable score and band per
 * user - the actual "risk engine" the flag log alone isn't. Built
 * deliberately as an aggregate: the whole point of scoring combined
 * signals, rather than acting on any one flag alone, is the
 * "do not automatically ban based on one heuristic" requirement -
 * a single LOW-severity flag should never be enough to reach HIGH or
 * CRITICAL on its own; only several signals compounding does that.
 */
@Injectable()
export class RiskEngineService {
  constructor(
    @InjectRepository(FraudFlag)
    private readonly flagsRepo: Repository<FraudFlag>,
    private readonly settingsService: SystemSettingsService,
  ) {}

  async assess(userId: string): Promise<RiskAssessment> {
    const lookbackDays = await this.settingsService.getNumber(SETTING_KEYS.RISK_LOOKBACK_DAYS, 30);
    const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

    // DISMISSED is explicitly excluded - an admin having already
    // reviewed a flag and determined it was a false positive means it
    // must stop contributing to this user's score, not just get a
    // note attached while still silently inflating it forever.
    const flags = await this.flagsRepo.find({
      where: [
        { userId, status: FraudFlagStatus.OPEN, createdAt: MoreThan(since) },
        { userId, status: FraudFlagStatus.REVIEWED, createdAt: MoreThan(since) },
      ],
      order: { createdAt: 'DESC' },
    });

    const weights = await this.loadWeights();
    const reasons: RiskReason[] = flags.map((f) => ({
      flagId: f.id,
      type: f.type,
      severity: f.severity,
      status: f.status,
      weight: weights[f.severity] ?? 0,
      occurredAt: f.createdAt,
      details: f.details,
    }));

    const score = reasons.reduce((sum, r) => sum + r.weight, 0);
    const band = await this.bandForScore(score);

    return { userId, score, band, reasons };
  }

  private async loadWeights(): Promise<Record<FraudFlagSeverity, number>> {
    const [low, medium, high, critical] = await Promise.all([
      this.settingsService.getNumber(SETTING_KEYS.RISK_WEIGHT_LOW, DEFAULT_WEIGHTS[FraudFlagSeverity.LOW]),
      this.settingsService.getNumber(SETTING_KEYS.RISK_WEIGHT_MEDIUM, DEFAULT_WEIGHTS[FraudFlagSeverity.MEDIUM]),
      this.settingsService.getNumber(SETTING_KEYS.RISK_WEIGHT_HIGH, DEFAULT_WEIGHTS[FraudFlagSeverity.HIGH]),
      this.settingsService.getNumber(SETTING_KEYS.RISK_WEIGHT_CRITICAL, DEFAULT_WEIGHTS[FraudFlagSeverity.CRITICAL]),
    ]);
    return {
      [FraudFlagSeverity.LOW]: low,
      [FraudFlagSeverity.MEDIUM]: medium,
      [FraudFlagSeverity.HIGH]: high,
      [FraudFlagSeverity.CRITICAL]: critical,
    };
  }

  private async bandForScore(score: number): Promise<RiskBand> {
    const [mediumAt, highAt, criticalAt] = await Promise.all([
      this.settingsService.getNumber(SETTING_KEYS.RISK_THRESHOLD_MEDIUM, 20),
      this.settingsService.getNumber(SETTING_KEYS.RISK_THRESHOLD_HIGH, 50),
      this.settingsService.getNumber(SETTING_KEYS.RISK_THRESHOLD_CRITICAL, 90),
    ]);
    if (score >= criticalAt) return RiskBand.CRITICAL;
    if (score >= highAt) return RiskBand.HIGH;
    if (score >= mediumAt) return RiskBand.MEDIUM;
    return RiskBand.LOW;
  }
}
