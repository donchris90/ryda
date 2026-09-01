import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Ride pooling (shared rides) foundation. Adds:
 *   - isPooled / poolGroupId / poolDiscountAmount to `rides` (each
 *     pooled trip is still two ordinary Ride rows, one per passenger —
 *     see PoolGroup for what's actually shared between them)
 *   - a new 'pool_matching' value on the rides status enum, for the
 *     batch-matching window a pooled request sits in before it pairs
 *     off or falls back to solo
 *
 * All-additive and defaulted so every existing ride row is unaffected.
 */
export class AddRidePoolingColumns1788600000000 implements MigrationInterface {
    name = 'AddRidePoolingColumns1788600000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TYPE "public"."rides_status_enum" ADD VALUE IF NOT EXISTS 'pool_matching'`);
        await queryRunner.query(`ALTER TABLE "rides" ADD "isPooled" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "rides" ADD "poolGroupId" character varying`);
        await queryRunner.query(`ALTER TABLE "rides" ADD "poolDiscountAmount" numeric(10,2) NOT NULL DEFAULT '0'`);
        await queryRunner.query(`CREATE INDEX "IDX_rides_poolGroupId" ON "rides" ("poolGroupId")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_rides_poolGroupId"`);
        await queryRunner.query(`ALTER TABLE "rides" DROP COLUMN "poolDiscountAmount"`);
        await queryRunner.query(`ALTER TABLE "rides" DROP COLUMN "poolGroupId"`);
        await queryRunner.query(`ALTER TABLE "rides" DROP COLUMN "isPooled"`);
        // Postgres has no DROP VALUE for enums — same limitation noted in
        // AddFraudFlagEscalatedStatus. Left as-is on rollback; harmless
        // if unused since no CHECK constraint enumerates allowed values
        // beyond the type itself.
    }

}
