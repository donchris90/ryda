import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `ride_offers.etaMinutes` and `estimatedDriverEarnings` - both
 * nullable, both computed at offer-creation time in
 * DispatchService.offerToSpecificDriver()/offerToNearestDriver() and
 * shown on the driver's offer screen alongside the existing distance
 * and fare fields. No backfill - historical offers never had this
 * data and aren't shown to a driver again anyway.
 */
export class AddRideOfferEtaAndEarnings1788300000000 implements MigrationInterface {
  name = 'AddRideOfferEtaAndEarnings1788300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "ride_offers" ADD "etaMinutes" integer`);
    await queryRunner.query(
      `ALTER TABLE "ride_offers" ADD "estimatedDriverEarnings" numeric(10,2)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "ride_offers" DROP COLUMN "estimatedDriverEarnings"`);
    await queryRunner.query(`ALTER TABLE "ride_offers" DROP COLUMN "etaMinutes"`);
  }
}
