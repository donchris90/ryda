import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * delivery_orders is missing three columns the DeliveryOrder entity has
 * declared since it was written: vehicleType, driverRating, and
 * driverRatingComment. None of these were ever added by a migration -
 * not in the InitialSchema CREATE TABLE, and not by any later ALTER.
 *
 * They were easy to miss because both names already exist elsewhere and
 * read as "already covered":
 *   - vehicleType exists on delivery_vehicle_type_configs (a *different*
 *     table - the fare-config row per vehicle type, added by
 *     CreateDeliveryVehicleTypeConfigs1788700000000), not on delivery_orders
 *     itself (the per-order record, which needs its own vehicleType to
 *     record which type THIS delivery actually used).
 *   - driverRating / driverRatingComment exist on `rides` (added in
 *     InitialSchema) but delivery_orders has its own copies for the same
 *     reason logistics.service.ts's rateDriver() writes to them.
 *
 * Effect until this runs: any query selecting delivery_orders.vehicleType
 * (LogisticsService.listForAdmin(), used by the admin Logistics page)
 * fails with Postgres 42703 (column does not exist), and any full-entity
 * find() against DeliveryOrder (getCourierPerformance(), findForCustomer(),
 * etc.) fails the same way since TypeORM selects every declared column.
 */
export class AddMissingDeliveryOrderColumns1790300000000 implements MigrationInterface {
  name = 'AddMissingDeliveryOrderColumns1790300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."delivery_orders_vehicletype_enum" AS ENUM('bike', 'keke', 'car', 'van', 'pickup', 'truck')`,
    );
    // Default of 'car' protects any existing rows from a NOT NULL failure
    // on this ALTER, matching the entity's own @Column default comment.
    await queryRunner.query(
      `ALTER TABLE "delivery_orders" ADD "vehicleType" "public"."delivery_orders_vehicletype_enum" NOT NULL DEFAULT 'car'`,
    );
    await queryRunner.query(`ALTER TABLE "delivery_orders" ADD "driverRating" integer`);
    await queryRunner.query(`ALTER TABLE "delivery_orders" ADD "driverRatingComment" character varying`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "delivery_orders" DROP COLUMN "driverRatingComment"`);
    await queryRunner.query(`ALTER TABLE "delivery_orders" DROP COLUMN "driverRating"`);
    await queryRunner.query(`ALTER TABLE "delivery_orders" DROP COLUMN "vehicleType"`);
    await queryRunner.query(`DROP TYPE "public"."delivery_orders_vehicletype_enum"`);
  }
}
