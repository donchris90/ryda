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
    await queryRunner.query(
      `CREATE TYPE "public"."delivery_orders_dispatchmode_enum" AS ENUM('auto', 'manual')`,
    );
    await queryRunner.query(
      `ALTER TABLE "delivery_orders" ADD "dispatchMode" "public"."delivery_orders_dispatchmode_enum" NOT NULL DEFAULT 'auto'`,
    );
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
