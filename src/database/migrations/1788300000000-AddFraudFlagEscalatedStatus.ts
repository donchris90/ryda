import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Admin fraud console (Batch 2) needs an intermediate state between "open"
 * and "reviewed/dismissed" so an analyst can flag a case for a more senior
 * reviewer without closing it out. Postgres allows appending a value to an
 * existing enum type with ALTER TYPE ... ADD VALUE, so unlike the
 * FixDriverAvailabilityLogsStatusEnum migration this doesn't need the
 * create-new-type/swap dance — there's no existing data to remap, we're
 * only ever adding a value nothing has used yet.
 *
 * Note: ALTER TYPE ... ADD VALUE cannot be reverted directly in Postgres
 * (no DROP VALUE). down() only provides a safe path if no row has actually
 * been set to 'escalated' yet, matching the constraint Postgres itself
 * imposes here.
 */
export class AddFraudFlagEscalatedStatus1788300000000 implements MigrationInterface {
    name = 'AddFraudFlagEscalatedStatus1788300000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TYPE "public"."fraud_flags_status_enum" ADD VALUE IF NOT EXISTS 'escalated'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        const inUse = await queryRunner.query(
            `SELECT 1 FROM "fraud_flags" WHERE "status" = 'escalated' LIMIT 1`,
        );
        if (inUse.length > 0) {
            throw new Error(
                'Cannot revert AddFraudFlagEscalatedStatus: fraud_flags rows exist with status = escalated. ' +
                'Re-review those flags to reviewed/dismissed before rolling back.',
            );
        }
        // Postgres has no DROP VALUE — rebuilding the type is the only way
        // back, same technique as FixDriverAvailabilityLogsStatusEnum.
        await queryRunner.query(`CREATE TYPE "public"."fraud_flags_status_enum_old" AS ENUM('open', 'reviewed', 'dismissed')`);
        await queryRunner.query(`ALTER TABLE "fraud_flags" ALTER COLUMN "status" TYPE "public"."fraud_flags_status_enum_old" USING ("status"::text)::"public"."fraud_flags_status_enum_old"`);
        await queryRunner.query(`DROP TYPE "public"."fraud_flags_status_enum"`);
        await queryRunner.query(`ALTER TYPE "public"."fraud_flags_status_enum_old" RENAME TO "fraud_flags_status_enum"`);
    }

}
