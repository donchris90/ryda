import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds cash_reconciliations.sourceType - existing rows are backfilled
 * to 'ride' via the column default, which is correct for every row
 * that predates this migration: COD-delivery debts only started
 * being recorded with this column available, so no historical row
 * needs distinguishing after the fact.
 */
export class AddSourceTypeToCashReconciliations1789800000000 implements MigrationInterface {
  name = 'AddSourceTypeToCashReconciliations1789800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."cash_reconciliations_sourcetype_enum" AS ENUM('ride', 'delivery')`,
    );
    await queryRunner.query(
      `ALTER TABLE "cash_reconciliations" ADD "sourceType" "public"."cash_reconciliations_sourcetype_enum" NOT NULL DEFAULT 'ride'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cash_reconciliations_sourceType" ON "cash_reconciliations" ("sourceType")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_cash_reconciliations_sourceType"`);
    await queryRunner.query(`ALTER TABLE "cash_reconciliations" DROP COLUMN "sourceType"`);
    await queryRunner.query(`DROP TYPE "public"."cash_reconciliations_sourcetype_enum"`);
  }
}
