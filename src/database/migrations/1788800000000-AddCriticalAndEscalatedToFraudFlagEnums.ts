import { MigrationInterface, QueryRunner } from 'typeorm';
/**
 * Fixes two real gaps found while building out the fraud/risk-engine
 * work this session, not just housekeeping:
 *
 * - fraud_flags_severity_enum was missing 'critical' - the risk
 *   engine's own band terminology (LOW/MEDIUM/HIGH/CRITICAL), and
 *   WithdrawalsService.initiateWithdrawal() already raises a flag at
 *   FraudFlagSeverity.CRITICAL when blocking a CRITICAL-risk
 *   withdrawal. That code path would have thrown a Postgres
 *   invalid-enum-value error on every actual CRITICAL-risk block
 *   until this migration runs.
 * - fraud_flags_status_enum was missing 'escalated' - the admin
 *   dashboard's Fraud page has an "Escalate" review action that's
 *   been sending this value since it was built, with no backend
 *   support for it at all.
 *
 * Guarded with a pg_enum existence check on each value: an earlier
 * partial/failed deploy may have already added one or both values to
 * the live database without the migration itself being recorded as
 * complete, so this must be safe to run again from a clean slate.
 */
export class AddCriticalAndEscalatedToFraudFlagEnums1788800000000 implements MigrationInterface {
  name = 'AddCriticalAndEscalatedToFraudFlagEnums1788800000000';
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_enum
          WHERE enumlabel = 'critical'
          AND enumtypid = 'public.fraud_flags_severity_enum'::regtype
        ) THEN
          ALTER TYPE "public"."fraud_flags_severity_enum" ADD VALUE 'critical';
        END IF;
      END
      $$;
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_enum
          WHERE enumlabel = 'escalated'
          AND enumtypid = 'public.fraud_flags_status_enum'::regtype
        ) THEN
          ALTER TYPE "public"."fraud_flags_status_enum" ADD VALUE 'escalated';
        END IF;
      END
      $$;
    `);
  }
  public async down(): Promise<void> {
    // Postgres has no DROP VALUE for enums - same irreversibility as
    // the earlier AddAdminToRideCancelledBy migration. down() is a
    // deliberate no-op rather than a lie about being able to undo this.
  }
}