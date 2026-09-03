import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Airport-specific refinements batch:
 *
 * - airport_zones: named pickup/dropoff points within an airport
 *   ("Terminal 1 Arrivals") - separate table, not a column on
 *   airports, since one airport can have many.
 * - airports.eligibleRideCategories: nullable jsonb array - null/[]
 *   means unrestricted (every existing airport row keeps working
 *   exactly as before).
 * - airport_queue_entries.vehicleCategory: nullable - captured going
 *   forward at joinQueue() time; existing queue rows (all currently
 *   'waiting' or resolved already) get null, which dispatchNext()
 *   treats as "not a category match" only when a category IS
 *   required - plain-FIFO dispatch (no category given) is unaffected.
 * - rides.pickupZoneName: nullable - set when a ride's pickup was
 *   resolved to a specific airport zone.
 */
export class AddAirportZonesAndEligibility1788200000000 implements MigrationInterface {
  name = 'AddAirportZonesAndEligibility1788200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "airport_zones" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "airportId" character varying NOT NULL, "name" character varying NOT NULL, "lat" double precision NOT NULL, "lng" double precision NOT NULL, "radiusKm" double precision NOT NULL DEFAULT '0.3', "isActive" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_airport_zones_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_airport_zones_airportId" ON "airport_zones" ("airportId")`,
    );

    await queryRunner.query(
      `ALTER TABLE "airports" ADD "eligibleRideCategories" jsonb`,
    );

    await queryRunner.query(
      `ALTER TABLE "airport_queue_entries" ADD "vehicleCategory" character varying`,
    );

    await queryRunner.query(
      `ALTER TABLE "rides" ADD "pickupZoneName" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "rides" DROP COLUMN "pickupZoneName"`);
    await queryRunner.query(
      `ALTER TABLE "airport_queue_entries" DROP COLUMN "vehicleCategory"`,
    );
    await queryRunner.query(
      `ALTER TABLE "airports" DROP COLUMN "eligibleRideCategories"`,
    );
    await queryRunner.query(`DROP INDEX "IDX_airport_zones_airportId"`);
    await queryRunner.query(`DROP TABLE "airport_zones"`);
  }
}
