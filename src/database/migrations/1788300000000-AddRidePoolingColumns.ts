import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Pooling (shared rides) columns on `rides`:
 *
 * - isPooled: false by default - flips true once PoolMatchingService
 *   pairs this ride off with a partner.
 * - poolGroupId: nullable, indexed - links the two Ride rows that make
 *   up one pooled trip. Cleared by unpoolRide()/unpoolRideMidTrip().
 * - poolDiscountAmount: decimal(10,2), default 0 - the fare reduction
 *   applied for riding pooled, refunded back into totalFare/discount
 *   when a pairing falls apart (see PoolMatchingService).
 *
 * Also adds the 'pool_matching' value to the ride status enum: the
 * batch-matching window before a pooled request either pairs off
 * (-> SEARCHING with a poolGroupId) or falls back to a solo SEARCHING
 * ride when the window expires unpaired.
 */
export class AddRidePoolingColumns1788300000000 implements MigrationInterface {
  name = 'AddRidePoolingColumns1788300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "rides" ADD "isPooled" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "rides" ADD "poolGroupId" character varying`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_rides_poolGroupId" ON "rides" ("poolGroupId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "rides" ADD "poolDiscountAmount" numeric(10,2) NOT NULL DEFAULT '0'`,
    );

    // Extend the rides_status_enum (Postgres enum type) with the new value.
    // Must run outside a transaction block per-statement in Postgres <12,
    // but ADD VALUE IF NOT EXISTS is fine in a single query like this.
    await queryRunner.query(
      `ALTER TYPE "public"."rides_status_enum" ADD VALUE IF NOT EXISTS 'pool_matching'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Postgres cannot drop a single value from an enum type; leaving
    // 'pool_matching' in rides_status_enum on rollback is intentional.
    await queryRunner.query(
      `ALTER TABLE "rides" DROP COLUMN "poolDiscountAmount"`,
    );
    await queryRunner.query(`DROP INDEX "IDX_rides_poolGroupId"`);
    await queryRunner.query(`ALTER TABLE "rides" DROP COLUMN "poolGroupId"`);
    await queryRunner.query(`ALTER TABLE "rides" DROP COLUMN "isPooled"`);
  }
}
