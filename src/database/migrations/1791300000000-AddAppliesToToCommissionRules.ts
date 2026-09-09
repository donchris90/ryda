import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAppliesToToCommissionRules1791300000000 implements MigrationInterface {
  name = 'AddAppliesToToCommissionRules1791300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "commission_rules" ADD COLUMN IF NOT EXISTS "appliesTo" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "commission_rules" DROP COLUMN "appliesTo"`);
  }
}
