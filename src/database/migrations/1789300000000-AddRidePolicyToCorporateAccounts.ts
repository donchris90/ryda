import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds ride-policy fields to corporate_accounts - allowed categories,
 * max fare per ride, operating hours, and allowed cities. All
 * nullable and default to unrestricted, so an existing corporate
 * account with no policy configured keeps working exactly as before.
 */
export class AddRidePolicyToCorporateAccounts1789300000000 implements MigrationInterface {
  name = 'AddRidePolicyToCorporateAccounts1789300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "corporate_accounts" ADD "allowedCategories" jsonb`);
    await queryRunner.query(`ALTER TABLE "corporate_accounts" ADD "maxFarePerRide" numeric(10,2)`);
    await queryRunner.query(`ALTER TABLE "corporate_accounts" ADD "operatingHoursStart" smallint`);
    await queryRunner.query(`ALTER TABLE "corporate_accounts" ADD "operatingHoursEnd" smallint`);
    await queryRunner.query(`ALTER TABLE "corporate_accounts" ADD "allowedCities" jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "corporate_accounts" DROP COLUMN "allowedCities"`);
    await queryRunner.query(`ALTER TABLE "corporate_accounts" DROP COLUMN "operatingHoursEnd"`);
    await queryRunner.query(`ALTER TABLE "corporate_accounts" DROP COLUMN "operatingHoursStart"`);
    await queryRunner.query(`ALTER TABLE "corporate_accounts" DROP COLUMN "maxFarePerRide"`);
    await queryRunner.query(`ALTER TABLE "corporate_accounts" DROP COLUMN "allowedCategories"`);
  }
}
