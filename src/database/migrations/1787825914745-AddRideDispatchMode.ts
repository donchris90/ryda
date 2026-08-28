import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Adds `rides.dispatchMode` (manual | auto) — Batch 6, Automatic Dispatch.
 *
 * Every existing row is backfilled to 'manual' via the column default,
 * which exactly matches how those rides actually behaved (there was no
 * AUTO path before this migration) — no behavior changes for historical
 * data, and no application code needs to special-case rows created
 * before this column existed.
 */
export class AddRideDispatchMode1787825914745 implements MigrationInterface {
    name = 'AddRideDispatchMode1787825914745'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."rides_dispatchmode_enum" AS ENUM('manual', 'auto')`);
        await queryRunner.query(`ALTER TABLE "rides" ADD "dispatchMode" "public"."rides_dispatchmode_enum" NOT NULL DEFAULT 'manual'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "rides" DROP COLUMN "dispatchMode"`);
        await queryRunner.query(`DROP TYPE "public"."rides_dispatchmode_enum"`);
    }

}
