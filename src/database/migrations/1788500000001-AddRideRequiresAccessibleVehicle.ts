import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Wheelchair-accessible ride requests: a hard filter on top of the
 * existing `category` (Economy/Comfort), not a third ride category - see
 * isWheelchairAccessibleVehicle() in ride-vehicle-match.util.ts for why.
 * Defaults to false so every existing ride row is unaffected.
 */
export class AddRideRequiresAccessibleVehicle1788500000001 implements MigrationInterface {
    name = 'AddRideRequiresAccessibleVehicle1788500000001'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "rides" ADD "requiresAccessibleVehicle" boolean NOT NULL DEFAULT false`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "rides" DROP COLUMN "requiresAccessibleVehicle"`);
    }

}
