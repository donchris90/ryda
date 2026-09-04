import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds rides.isPooled - distinct from the already-existing poolGroupId
 * (only set once a match actually succeeds). isPooled records the
 * passenger's own request-time choice and stays true even if the ride
 * later falls back to solo dispatch after an unmatched pool window, or
 * gets unpooled mid-trip.
 */
export class AddIsPooledToRides1789600000000 implements MigrationInterface {
  name = 'AddIsPooledToRides1789600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "rides" ADD "isPooled" boolean NOT NULL DEFAULT false`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "rides" DROP COLUMN "isPooled"`);
  }
}
