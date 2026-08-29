import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `delivery_orders.dispatchMode` (auto | manual) — OPTION A (auto-
 * match) vs OPTION B (choose a courier), the same distinction rides
 * already have via AddRideDispatchMode.
 *
 * Default is 'auto', not 'manual' — the opposite default from rides'
 * migration, and deliberately so: every delivery ever created before
 * this column existed was broadcast to every eligible driver
 * immediately (see LogisticsService.requestDelivery()'s pre-existing
 * unconditional broadcast), which is exactly what AUTO means here.
 * Backfilling to 'manual' would misdescribe historical rows as
 * "awaiting passenger selection" when they were never that.
 */
export class AddDeliveryDispatchMode1787900000000 implements MigrationInterface {
  name = 'AddDeliveryDispatchMode1787900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Idempotent by construction — this migration has a documented history
    // of being marked "already applied" (via
    // scripts/mark-legacy-migrations-applied.js, on the assumption that
    // `synchronize: true` had already created it) in an environment where
    // the column had NOT actually been created yet, permanently wedging
    // `migration:run` into skipping the one statement that would have
    // fixed it. Guarding both statements means this migration is always
    // safe to (re-)run by hand against a production DB to recover from
    // exactly that situation, regardless of what the `migrations` table
    // currently claims.
    const enumExists = await queryRunner.query(
      `SELECT 1 FROM pg_type WHERE typname = 'delivery_orders_dispatchmode_enum'`,
    );
    if (enumExists.length === 0) {
      await queryRunner.query(
        `CREATE TYPE "public"."delivery_orders_dispatchmode_enum" AS ENUM('auto', 'manual')`,
      );
    }

    const columnExists = await queryRunner.query(
      `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'delivery_orders' AND column_name = 'dispatchMode'`,
    );
    if (columnExists.length === 0) {
      await queryRunner.query(
        `ALTER TABLE "delivery_orders" ADD "dispatchMode" "public"."delivery_orders_dispatchmode_enum" NOT NULL DEFAULT 'auto'`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "delivery_orders" DROP COLUMN "dispatchMode"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."delivery_orders_dispatchmode_enum"`,
    );
  }
}
