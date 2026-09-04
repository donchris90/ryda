import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { RideCategory } from '../../common/enums/ride.enum';

@Entity('corporate_accounts')
export class CorporateAccount {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  ownerUserId: string;

  @Column()
  companyName: string;

  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0 })
  budgetBalance: string;

  @Column({ default: 'NGN' })
  currency: string;

  @Column({ default: true })
  isActive: boolean;

  // ---- Ride policy (all null = unrestricted on that dimension) ----
  // Enforced in RidesService.requestRide()'s CORPORATE payment branch,
  // against the estimated fare/category/city/time already resolved
  // for that request - not a separate policy-check pass with its own
  // fare recalculation.
  @Column({ type: 'jsonb', nullable: true })
  allowedCategories: RideCategory[] | null;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  maxFarePerRide: string | null;

  // Hour-of-day, 0-23, in the platform's local time - operatingHoursEnd
  // can be numerically less than operatingHoursStart (e.g. 22 -> 6) to
  // express a window that crosses midnight; that wraparound is handled
  // in CorporateService.checkRidePolicy(), not by two separate fields.
  @Column({ type: 'smallint', nullable: true })
  operatingHoursStart: number | null;

  @Column({ type: 'smallint', nullable: true })
  operatingHoursEnd: number | null;

  @Column({ type: 'jsonb', nullable: true })
  allowedCities: string[] | null;

  // Soft threshold, deliberately separate from maxFarePerRide (the
  // hard block above): a ride over THIS amount still goes ahead in
  // real time - it's just flagged in corporate_ride_approvals for a
  // manager to review afterward, rather than refused outright the
  // way exceeding maxFarePerRide is. Null = nothing gets flagged.
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  requiresApprovalAboveFare: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
