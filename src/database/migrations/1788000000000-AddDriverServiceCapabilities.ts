import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Driver Service Capabilities — separates "what a driver is approved to
 * provide" (RIDE / DELIVERY / both) from "what they're currently
 * accepting" (their `availability`), and from their registered vehicle.
 *
 * Two independent changes bundled together because the second one only
 * makes sense in terms of the first:
 *
 * 1. New `driver_service_capabilities` table: one row per
 *    (driverProfile, service), with its own pending/approved/rejected
 *    status. Registering for a service creates a PENDING row; only an
 *    admin decision (DriversService.decideServiceCapability()) can move
 *    it to APPROVED — see drivers.controller.ts's
 *    PATCH :driverId/services/:service/:status.
 *
 * 2. `driver_profiles.availability` gains three specific "online for X"
 *    values (ONLINE_FOR_RIDES / ONLINE_FOR_DELIVERIES / ONLINE_FOR_BOTH)
 *    replacing the single generic ONLINE. This also finally adds the
 *    'break' value the TypeScript enum already had but the Postgres
 *    enum type never did (a pre-existing gap found while making this
 *    change, not introduced by it — BREAK was reachable in code but
 *    would have failed at the database with an invalid-enum-value
 *    error).
 *
 * BACKWARD-COMPATIBILITY MAPPING (deterministic, documented):
 * The existing schema never distinguished ride vs delivery drivers at
 * all — every approved, online driver was already eligible for both
 * via the shared candidate-search pipeline (see CandidateSearchService
 * before this batch). So the only mapping that doesn't silently take
 * driver earning capacity away is:
 *
 *   driver_profiles.approvalStatus = 'approved'  -> both RIDE and
 *     DELIVERY capability rows created as APPROVED
 *   driver_profiles.approvalStatus = 'rejected'  -> both created as
 *     REJECTED
 *   anything else (pending / under_review / suspended) -> both created
 *     as PENDING (matches: they couldn't dispatch for anything before
 *     this migration either)
 *
 *   driver_profiles.availability = 'online'   -> 'online_for_both'
 *   driver_profiles.availability = 'on_trip'  -> 'on_trip' (unchanged;
 *     lastOnlineAvailability backfilled to 'online_for_both' as the
 *     best-effort restore target once their in-flight trip ends)
 *   driver_profiles.availability = 'offline'  -> 'offline' (unchanged)
 *
 * No trips, vehicles, or approval statuses are touched by this
 * migration — only the availability enum values and the new capability
 * table.
 */
export class AddDriverServiceCapabilities1788000000000 implements MigrationInterface {
    name = 'AddDriverServiceCapabilities1788000000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // --- 1. Widen driver_profiles.availability ---
        await queryRunner.query(`CREATE TYPE "public"."driver_profiles_availability_enum_new" AS ENUM('offline', 'online_for_rides', 'online_for_deliveries', 'online_for_both', 'on_trip', 'break')`);

        await queryRunner.query(`ALTER TABLE "driver_profiles" ALTER COLUMN "availability" DROP DEFAULT`);
        await queryRunner.query(`
            ALTER TABLE "driver_profiles"
            ALTER COLUMN "availability" TYPE "public"."driver_profiles_availability_enum_new"
            USING (
                CASE "availability"::text
                    WHEN 'online' THEN 'online_for_both'
                    ELSE "availability"::text
                END
            )::"public"."driver_profiles_availability_enum_new"
        `);
        await queryRunner.query(`ALTER TABLE "driver_profiles" ALTER COLUMN "availability" SET DEFAULT 'offline'`);

        await queryRunner.query(`DROP TYPE "public"."driver_profiles_availability_enum"`);
        await queryRunner.query(`ALTER TYPE "public"."driver_profiles_availability_enum_new" RENAME TO "driver_profiles_availability_enum"`);

        // --- 2. lastOnlineAvailability: remembers the specific online
        // state a driver was reserved from, so restoreAvailabilityAfterTrip()
        // can put them back exactly where they were rather than a single
        // hardcoded value. Backfilled for anyone currently online or
        // on-trip; null for anyone offline (nothing to restore to).
        await queryRunner.query(`ALTER TABLE "driver_profiles" ADD "lastOnlineAvailability" "public"."driver_profiles_availability_enum"`);
        await queryRunner.query(`
            UPDATE "driver_profiles"
            SET "lastOnlineAvailability" = 'online_for_both'
            WHERE "availability" IN ('online_for_both', 'on_trip')
        `);

        // --- 3. New driver_service_capabilities table ---
        await queryRunner.query(`CREATE TYPE "public"."driver_service_capabilities_service_enum" AS ENUM('ride', 'delivery')`);
        await queryRunner.query(`CREATE TYPE "public"."driver_service_capabilities_status_enum" AS ENUM('pending', 'approved', 'rejected')`);
        await queryRunner.query(`
            CREATE TABLE "driver_service_capabilities" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "driverProfileId" uuid NOT NULL,
                "service" "public"."driver_service_capabilities_service_enum" NOT NULL,
                "status" "public"."driver_service_capabilities_status_enum" NOT NULL DEFAULT 'pending',
                "decidedAt" TIMESTAMP,
                "decidedByUserId" character varying,
                "rejectionReason" character varying,
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_driver_service_capabilities_id" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_driver_service_capabilities_driver_service" ON "driver_service_capabilities" ("driverProfileId", "service")`);
        await queryRunner.query(`CREATE INDEX "IDX_driver_service_capabilities_driverProfileId" ON "driver_service_capabilities" ("driverProfileId")`);
        await queryRunner.query(`
            ALTER TABLE "driver_service_capabilities"
            ADD CONSTRAINT "FK_driver_service_capabilities_driverProfileId"
            FOREIGN KEY ("driverProfileId") REFERENCES "driver_profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);

        // --- 4. Deterministic backfill for every existing driver — see
        // the class doc comment above for exactly why this mapping (and
        // no other) is the safe, documented one.
        await queryRunner.query(`
            INSERT INTO "driver_service_capabilities" ("driverProfileId", "service", "status", "decidedAt")
            SELECT
                dp."id",
                svc.service::"public"."driver_service_capabilities_service_enum",
                CASE dp."approvalStatus"::text
                    WHEN 'approved' THEN 'approved'
                    WHEN 'rejected' THEN 'rejected'
                    ELSE 'pending'
                END::"public"."driver_service_capabilities_status_enum",
                CASE WHEN dp."approvalStatus"::text IN ('approved', 'rejected') THEN dp."updatedAt" ELSE NULL END
            FROM "driver_profiles" dp
            CROSS JOIN (SELECT unnest(ARRAY['ride', 'delivery']) AS service) svc
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "driver_service_capabilities" DROP CONSTRAINT "FK_driver_service_capabilities_driverProfileId"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_driver_service_capabilities_driverProfileId"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_driver_service_capabilities_driver_service"`);
        await queryRunner.query(`DROP TABLE "driver_service_capabilities"`);
        await queryRunner.query(`DROP TYPE "public"."driver_service_capabilities_status_enum"`);
        await queryRunner.query(`DROP TYPE "public"."driver_service_capabilities_service_enum"`);

        await queryRunner.query(`ALTER TABLE "driver_profiles" DROP COLUMN "lastOnlineAvailability"`);

        await queryRunner.query(`CREATE TYPE "public"."driver_profiles_availability_enum_old" AS ENUM('offline', 'online', 'on_trip')`);
        await queryRunner.query(`ALTER TABLE "driver_profiles" ALTER COLUMN "availability" DROP DEFAULT`);
        await queryRunner.query(`
            ALTER TABLE "driver_profiles"
            ALTER COLUMN "availability" TYPE "public"."driver_profiles_availability_enum_old"
            USING (
                CASE "availability"::text
                    WHEN 'online_for_rides' THEN 'online'
                    WHEN 'online_for_deliveries' THEN 'online'
                    WHEN 'online_for_both' THEN 'online'
                    -- BREAK never existed in the old enum either; there is
                    -- no lossless rollback for it, so it degrades to
                    -- OFFLINE rather than failing the down-migration.
                    WHEN 'break' THEN 'offline'
                    ELSE "availability"::text
                END
            )::"public"."driver_profiles_availability_enum_old"
        `);
        await queryRunner.query(`ALTER TABLE "driver_profiles" ALTER COLUMN "availability" SET DEFAULT 'offline'`);
        await queryRunner.query(`DROP TYPE "public"."driver_profiles_availability_enum"`);
        await queryRunner.query(`ALTER TYPE "public"."driver_profiles_availability_enum_old" RENAME TO "driver_profiles_availability_enum"`);
    }

}
