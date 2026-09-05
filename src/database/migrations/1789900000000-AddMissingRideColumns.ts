import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds six Ride entity columns that were declared in code (PIN
 * verification, trip sharing, tipping, restricted-zone warnings) but
 * never actually had a migration written for any of them - confirmed
 * by cross-referencing every column on the Ride entity against every
 * existing migration, including InitialSchema, and finding none of
 * these six mentioned anywhere.
 *
 * Found from a real production error: SafetyMonitoringService's
 * checkGpsFreshness() cron job failing with "column Ride.tipAmount
 * does not exist" - any query selecting the full Ride entity (most of
 * them, since ridesRepo.find() and similar select every column by
 * default) would fail the same way against a database that only ever
 * ran `migration:run` (never `synchronize`), just on whichever of
 * these six columns Postgres happened to hit first.
 *
 * All six are either nullable or have a default, so this is safe to
 * run against a table that already has rows.
 */
export class AddMissingRideColumns1789900000000 implements MigrationInterface {
  name = 'AddMissingRideColumns1789900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "rides" ADD COLUMN IF NOT EXISTS "verificationPin" character varying`);
    await queryRunner.query(`ALTER TABLE "rides" ADD COLUMN IF NOT EXISTS "isPinVerified" boolean NOT NULL DEFAULT false`);
    await queryRunner.query(`ALTER TABLE "rides" ADD COLUMN IF NOT EXISTS "pinAttemptCount" integer NOT NULL DEFAULT 0`);
    await queryRunner.query(`ALTER TABLE "rides" ADD COLUMN IF NOT EXISTS "restrictedZoneWarning" character varying`);
    await queryRunner.query(`ALTER TABLE "rides" ADD COLUMN IF NOT EXISTS "shareToken" character varying`);
    // ADD CONSTRAINT has no IF NOT EXISTS in Postgres - guarded manually
    // via a catalog check instead, so re-running this migration (or a
    // database where shareToken/its constraint already exists in some
    // form) doesn't hard-fail on a duplicate constraint name.
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'UQ_rides_shareToken'
        ) THEN
          ALTER TABLE "rides" ADD CONSTRAINT "UQ_rides_shareToken" UNIQUE ("shareToken");
        END IF;
      END $$;
    `);
    await queryRunner.query(`ALTER TABLE "rides" ADD COLUMN IF NOT EXISTS "tipAmount" numeric(10,2) NOT NULL DEFAULT 0`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "rides" DROP COLUMN IF EXISTS "tipAmount"`);
    await queryRunner.query(`ALTER TABLE "rides" DROP CONSTRAINT IF EXISTS "UQ_rides_shareToken"`);
    await queryRunner.query(`ALTER TABLE "rides" DROP COLUMN IF EXISTS "shareToken"`);
    await queryRunner.query(`ALTER TABLE "rides" DROP COLUMN IF EXISTS "restrictedZoneWarning"`);
    await queryRunner.query(`ALTER TABLE "rides" DROP COLUMN IF EXISTS "pinAttemptCount"`);
    await queryRunner.query(`ALTER TABLE "rides" DROP COLUMN IF EXISTS "isPinVerified"`);
    await queryRunner.query(`ALTER TABLE "rides" DROP COLUMN IF EXISTS "verificationPin"`);
  }
}
