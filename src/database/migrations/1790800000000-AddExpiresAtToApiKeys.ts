import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddExpiresAtToApiKeys1790800000000 implements MigrationInterface {
  name = 'AddExpiresAtToApiKeys1790800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "api_keys" DROP COLUMN "expiresAt"`);
  }
}
