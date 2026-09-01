import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Adds VehicleCategory.WHEELCHAIR_ACCESSIBLE. Two Postgres enum types back
 * this single TS enum (see InitialSchema) - vehicles.category and
 * commission_rules.vehicleCategory were generated as separate types even
 * though they share the same TS values, so both need the new value.
 *
 * Pure append, same technique as AddFraudFlagEscalatedStatus: no existing
 * data to remap, nothing has used this value yet, so ALTER TYPE ... ADD
 * VALUE is sufficient and down() only needs to guard against rows that
 * have since been set to it.
 */
export class AddWheelchairAccessibleVehicleCategory1788500000000 implements MigrationInterface {
    name = 'AddWheelchairAccessibleVehicleCategory1788500000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TYPE "public"."vehicles_category_enum" ADD VALUE IF NOT EXISTS 'wheelchair_accessible'`);
        await queryRunner.query(`ALTER TYPE "public"."commission_rules_vehiclecategory_enum" ADD VALUE IF NOT EXISTS 'wheelchair_accessible'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        const vehiclesInUse = await queryRunner.query(
            `SELECT 1 FROM "vehicles" WHERE "category" = 'wheelchair_accessible' LIMIT 1`,
        );
        if (vehiclesInUse.length > 0) {
            throw new Error(
                'Cannot revert AddWheelchairAccessibleVehicleCategory: vehicles rows exist with category = wheelchair_accessible. ' +
                'Recategorize those vehicles before rolling back.',
            );
        }
        const commissionRulesInUse = await queryRunner.query(
            `SELECT 1 FROM "commission_rules" WHERE "vehicleCategory" = 'wheelchair_accessible' LIMIT 1`,
        );
        if (commissionRulesInUse.length > 0) {
            throw new Error(
                'Cannot revert AddWheelchairAccessibleVehicleCategory: commission_rules rows exist with vehicleCategory = wheelchair_accessible. ' +
                'Remove or reassign those rules before rolling back.',
            );
        }

        // Postgres has no DROP VALUE - rebuild both types, same technique as
        // FixDriverAvailabilityLogsStatusEnum / AddFraudFlagEscalatedStatus.
        await queryRunner.query(`CREATE TYPE "public"."vehicles_category_enum_old" AS ENUM('car', 'suv', 'taxi', 'luxury', 'ev', 'motorcycle', 'tricycle', 'van', 'bus', 'truck')`);
        await queryRunner.query(`ALTER TABLE "vehicles" ALTER COLUMN "category" TYPE "public"."vehicles_category_enum_old" USING ("category"::text)::"public"."vehicles_category_enum_old"`);
        await queryRunner.query(`DROP TYPE "public"."vehicles_category_enum"`);
        await queryRunner.query(`ALTER TYPE "public"."vehicles_category_enum_old" RENAME TO "vehicles_category_enum"`);

        await queryRunner.query(`CREATE TYPE "public"."commission_rules_vehiclecategory_enum_old" AS ENUM('car', 'suv', 'taxi', 'luxury', 'ev', 'motorcycle', 'tricycle', 'van', 'bus', 'truck')`);
        await queryRunner.query(`ALTER TABLE "commission_rules" ALTER COLUMN "vehicleCategory" TYPE "public"."commission_rules_vehiclecategory_enum_old" USING ("vehicleCategory"::text)::"public"."commission_rules_vehiclecategory_enum_old"`);
        await queryRunner.query(`DROP TYPE "public"."commission_rules_vehiclecategory_enum"`);
        await queryRunner.query(`ALTER TYPE "public"."commission_rules_vehiclecategory_enum_old" RENAME TO "commission_rules_vehiclecategory_enum"`);
    }

}
