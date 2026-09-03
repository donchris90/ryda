import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `rides.pickupEntranceLat` / `pickupEntranceLng` - the nearest
 * Google entrance/access-point to the pickup coordinate, resolved via
 * GET /maps/place-details?includeEntrances=true and picked with
 * GoogleMapsService.nearestAccessPoint(). Both nullable: most pickups
 * have no entrance data, and a bare dropped pin (not a searched place)
 * never will. No backfill - historical rides never had this data.
 */
export class AddRidePickupEntrance1788100000000 implements MigrationInterface {
  name = 'AddRidePickupEntrance1788100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "rides" ADD "pickupEntranceLat" double precision`,
    );
    await queryRunner.query(
      `ALTER TABLE "rides" ADD "pickupEntranceLng" double precision`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "rides" DROP COLUMN "pickupEntranceLng"`,
    );
    await queryRunner.query(
      `ALTER TABLE "rides" DROP COLUMN "pickupEntranceLat"`,
    );
  }
}
