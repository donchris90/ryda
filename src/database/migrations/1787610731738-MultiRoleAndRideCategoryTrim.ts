import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Two independent changes, bundled because they landed together:
 *
 * 1. Multi-role accounts: adds `users.roles` (array) alongside the
 *    existing single `role` column, backfilled from it, so one login can
 *    hold more than one role (e.g. a passenger who also drives) without a
 *    second account. `role` is kept as the "primary/default role" for
 *    display purposes; authorization now checks `roles`.
 *
 * 2. Ride categories trimmed to economy/comfort. Any existing rides with
 *    a category outside that pair (executive, xl, suv, electric,
 *    motorcycle, tricycle, taxi, luxury) are remapped to `economy` before
 *    the enum is narrowed, since Postgres won't let a column keep values
 *    that no longer exist on its enum type.
 */
export class MultiRoleAndRideCategoryTrim1787610731738 implements MigrationInterface {
    name = 'MultiRoleAndRideCategoryTrim1787610731738'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // --- 1. users.roles ---
        await queryRunner.query(`ALTER TABLE "users" ADD "roles" "public"."users_role_enum" array NOT NULL DEFAULT '{passenger}'`);
        await queryRunner.query(`UPDATE "users" SET "roles" = ARRAY["role"]::"public"."users_role_enum"[]`);

        // --- 2. rides.category: economy/comfort only ---
        await queryRunner.query(`UPDATE "rides" SET "category" = 'economy' WHERE "category"::text NOT IN ('economy', 'comfort')`);
        await queryRunner.query(`ALTER TYPE "public"."rides_category_enum" RENAME TO "rides_category_enum_old"`);
        await queryRunner.query(`CREATE TYPE "public"."rides_category_enum" AS ENUM('economy', 'comfort')`);
        await queryRunner.query(`ALTER TABLE "rides" ALTER COLUMN "category" TYPE "public"."rides_category_enum" USING "category"::text::"public"."rides_category_enum"`);
        await queryRunner.query(`DROP TYPE "public"."rides_category_enum_old"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // --- 2 (reverse): restore the wider category enum ---
        await queryRunner.query(`ALTER TYPE "public"."rides_category_enum" RENAME TO "rides_category_enum_old"`);
        await queryRunner.query(`CREATE TYPE "public"."rides_category_enum" AS ENUM('economy', 'comfort', 'executive', 'xl', 'suv', 'electric', 'motorcycle', 'tricycle', 'taxi', 'luxury')`);
        await queryRunner.query(`ALTER TABLE "rides" ALTER COLUMN "category" TYPE "public"."rides_category_enum" USING "category"::text::"public"."rides_category_enum"`);
        await queryRunner.query(`DROP TYPE "public"."rides_category_enum_old"`);

        // --- 1 (reverse): drop users.roles ---
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "roles"`);
    }

}
