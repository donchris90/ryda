import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the driver availability history table before the enum-fix migration
 * that follows it. This is required because the initial schema did not create
 * driver_availability_logs even though the entity/service depends on it.
 */
export class CreateDriverAvailabilityLogs1788050000000 implements MigrationInterface {
  name = 'CreateDriverAvailabilityLogs1788050000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "public"."driver_availability_logs_status_enum" AS ENUM('offline', 'online', 'on_trip')
    `);

    await queryRunner.query(`
      CREATE TABLE "driver_availability_logs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "driverUserId" character varying NOT NULL,
        "status" "public"."driver_availability_logs_status_enum" NOT NULL,
        "startedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "endedAt" TIMESTAMP,
        CONSTRAINT "PK_driver_availability_logs_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_driver_availability_logs_driverUserId"
      ON "driver_availability_logs" ("driverUserId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_driver_availability_logs_driverUserId"`);
    await queryRunner.query(`DROP TABLE "driver_availability_logs"`);
    await queryRunner.query(`DROP TYPE "public"."driver_availability_logs_status_enum"`);
  }
}
