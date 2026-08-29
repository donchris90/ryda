import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Bug fix: 1788000000000-AddDriverServiceCapabilities widened
 * driver_profiles.availability to the six-value set (offline /
 * online_for_rides / online_for_deliveries / online_for_both / on_trip /
 * break) but never touched driver_availability_logs.status, a separate
 * Postgres enum type (TypeORM generates one enum type per column, not
 * one shared type per TS enum). DriverAvailabilityLog uses the same
 * DriverAvailability TS enum, so DriversService.setAvailabilityInternal()
 * has been failing with "invalid input value for enum
 * driver_availability_logs_status_enum" every time a driver goes online
 * for a value the old 3-value enum doesn't have — most visibly
 * ONLINE_FOR_BOTH, but ONLINE_FOR_RIDES / ONLINE_FOR_DELIVERIES / BREAK
 * are equally broken. The driver_profiles row itself already saved
 * successfully by the time this insert runs, so the failure only
 * surfaces as a 500 on the availability-change request, not a rolled
 * back availability change (see DriversService.setAvailabilityInternal —
 * the profile save() and the log insert are two separate statements, not
 * wrapped in a transaction here).
 *
 * Same backward-compatibility mapping as the original migration:
 * historical 'online' rows become 'online_for_both' (log rows never
 * distinguished ride vs delivery either, same reasoning as that
 * migration's driver_profiles.availability backfill).
 */
export class FixDriverAvailabilityLogsStatusEnum1788100000000 implements MigrationInterface {
    name = 'FixDriverAvailabilityLogsStatusEnum1788100000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."driver_availability_logs_status_enum_new" AS ENUM('offline', 'online_for_rides', 'online_for_deliveries', 'online_for_both', 'on_trip', 'break')`);

        await queryRunner.query(`
            ALTER TABLE "driver_availability_logs"
            ALTER COLUMN "status" TYPE "public"."driver_availability_logs_status_enum_new"
            USING (
                CASE "status"::text
                    WHEN 'online' THEN 'online_for_both'
                    ELSE "status"::text
                END
            )::"public"."driver_availability_logs_status_enum_new"
        `);

        await queryRunner.query(`DROP TYPE "public"."driver_availability_logs_status_enum"`);
        await queryRunner.query(`ALTER TYPE "public"."driver_availability_logs_status_enum_new" RENAME TO "driver_availability_logs_status_enum"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."driver_availability_logs_status_enum_old" AS ENUM('offline', 'online', 'on_trip')`);

        await queryRunner.query(`
            ALTER TABLE "driver_availability_logs"
            ALTER COLUMN "status" TYPE "public"."driver_availability_logs_status_enum_old"
            USING (
                CASE "status"::text
                    WHEN 'online_for_rides' THEN 'online'
                    WHEN 'online_for_deliveries' THEN 'online'
                    WHEN 'online_for_both' THEN 'online'
                    -- No lossless rollback for BREAK, same as the
                    -- original migration's down() for driver_profiles.
                    WHEN 'break' THEN 'offline'
                    ELSE "status"::text
                END
            )::"public"."driver_availability_logs_status_enum_old"
        `);

        await queryRunner.query(`DROP TYPE "public"."driver_availability_logs_status_enum"`);
        await queryRunner.query(`ALTER TYPE "public"."driver_availability_logs_status_enum_old" RENAME TO "driver_availability_logs_status_enum"`);
    }

}
