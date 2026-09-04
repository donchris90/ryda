import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds department + monthlySpendLimit to corporate_employees, and
 * employeeUserId + department to corporate_transactions. Before this,
 * a corporate transaction was only ever attributable to the account
 * as a whole - there was no way to compute "how much has employee X
 * spent" or "how much has department Y spent" at all, which made
 * both per-employee spending limits and departmental reporting
 * structurally impossible, not just unbuilt.
 */
export class AddCorporateDepartmentsAndSpendLimits1789400000000 implements MigrationInterface {
  name = 'AddCorporateDepartmentsAndSpendLimits1789400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "corporate_employees" ADD "department" character varying`);
    await queryRunner.query(`ALTER TABLE "corporate_employees" ADD "monthlySpendLimit" numeric(10,2)`);
    await queryRunner.query(`ALTER TABLE "corporate_transactions" ADD "employeeUserId" character varying`);
    await queryRunner.query(`ALTER TABLE "corporate_transactions" ADD "department" character varying`);
    await queryRunner.query(
      `CREATE INDEX "IDX_corporate_transactions_employeeUserId" ON "corporate_transactions" ("employeeUserId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_corporate_transactions_employeeUserId"`);
    await queryRunner.query(`ALTER TABLE "corporate_transactions" DROP COLUMN "department"`);
    await queryRunner.query(`ALTER TABLE "corporate_transactions" DROP COLUMN "employeeUserId"`);
    await queryRunner.query(`ALTER TABLE "corporate_employees" DROP COLUMN "monthlySpendLimit"`);
    await queryRunner.query(`ALTER TABLE "corporate_employees" DROP COLUMN "department"`);
  }
}
