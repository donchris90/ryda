import { MigrationInterface, QueryRunner } from 'typeorm';
/**
 * Adds rides.isPooled - distinct from the already-existing poolGroupId
 * (only set once a match actually succeeds). isPooled records the
 * passenger's own request-time choice and stays true even if the ride
 * later falls back to solo dispatch after an unmatched pool window, or
 * gets unpooled mid-trip.
 *
 * Guarded with IF NOT EXISTS: an earlier partial/failed deploy may
 * have already added this column to the live database without the
 * migration itself being recorded as complete, so this must be safe
 * to run again from a clean slate.
 */
export class AddIsPooledToRides1789600000000 implements MigrationInterface {
  name = 'AddIsPooledToRides1789600000000';
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "rides" ADD COLUMN IF NOT EXISTS "isPooled" boolean NOT NULL DEFAULT false`);
  }
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "rides" DROP COLUMN IF EXISTS "isPooled"`);
  }
}