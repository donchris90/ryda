import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Creates the availability history table used by DriversService and
 * DriverAnalyticsService.
 *
 * This table was missing from the migration chain even though the entity
 * existed from the initial schema. It must exist before
 * FixDriverAvailabilityLogsStatusEnum runs.
 *
 * The initial enum intentionally uses the legacy three-value set because
 * migration 1788100000000 is responsible for widening it to the current
 * six-value DriverAvailability enum and mapping historical `online` rows to
 * `online_for_both`.
 */
export class CreateDriverAvailabilityLogs1788050000000 implements MigrationInterface {
    name = 'CreateDriverAvailabilityLogs1788050000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        const tableExists = await queryRunner.hasTable('driver_availability_logs');

        if (tableExists) {
            return;
        }

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
        const tableExists = await queryRunner.hasTable('driver_availability_logs');

        if (!tableExists) {
            return;
        }

        await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_driver_availability_logs_driverUserId"`);
        await queryRunner.query(`DROP TABLE "driver_availability_logs"`);
        await queryRunner.query(`DROP TYPE IF EXISTS "public"."driver_availability_logs_status_enum"`);
    }
}
