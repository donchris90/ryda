import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Remaining column-level drift found by the same full-entity-vs-migration
 * audit that produced AddMissingRideColumns and AddMissingTables. These are
 * on tables that DO exist, so the blast radius is narrower than the two
 * migrations above, but each is still a real gap on a live table:
 *
 *   - driver_documents.expiryWarningSent            (document-expiry reminder tracking)
 *   - driver_profiles.consecutiveDuplicateLocationCount (stale/parked-driver detection)
 *   - incidents.respondingBy / escalatedBy / escalationReason / escalatedAt
 *       (safety: emergency escalation lifecycle - Batch 8)
 *   - payment_records.pendingRefundAmount           (financial: in-flight refund tracking)
 *   - vehicles.approvedRideCategories                (which ride categories a vehicle may serve)
 */
export class AddMissingColumnsOnExistingTables1790100000000 implements MigrationInterface {
  name = 'AddMissingColumnsOnExistingTables1790100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "driver_documents" ADD "expiryWarningSent" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "driver_profiles" ADD "consecutiveDuplicateLocationCount" integer NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(`ALTER TABLE "incidents" ADD "respondingBy" character varying`);
    await queryRunner.query(`ALTER TABLE "incidents" ADD "escalatedBy" character varying`);
    await queryRunner.query(`ALTER TABLE "incidents" ADD "escalationReason" character varying`);
    await queryRunner.query(`ALTER TABLE "incidents" ADD "escalatedAt" TIMESTAMP`);
    await queryRunner.query(
      `ALTER TABLE "payment_records" ADD "pendingRefundAmount" numeric(10,2)`,
    );
    await queryRunner.query(
      `ALTER TABLE "vehicles" ADD "approvedRideCategories" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "vehicles" DROP COLUMN "approvedRideCategories"`);
    await queryRunner.query(`ALTER TABLE "payment_records" DROP COLUMN "pendingRefundAmount"`);
    await queryRunner.query(`ALTER TABLE "incidents" DROP COLUMN "escalatedAt"`);
    await queryRunner.query(`ALTER TABLE "incidents" DROP COLUMN "escalationReason"`);
    await queryRunner.query(`ALTER TABLE "incidents" DROP COLUMN "escalatedBy"`);
    await queryRunner.query(`ALTER TABLE "incidents" DROP COLUMN "respondingBy"`);
    await queryRunner.query(
      `ALTER TABLE "driver_profiles" DROP COLUMN "consecutiveDuplicateLocationCount"`,
    );
    await queryRunner.query(`ALTER TABLE "driver_documents" DROP COLUMN "expiryWarningSent"`);
  }
}
