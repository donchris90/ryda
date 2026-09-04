import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds session-context columns to refresh_tokens - deviceFingerprint,
 * ipAddress, userAgent - captured at issue time (login and each
 * refresh-rotation). Backs two things that had no data to work from
 * before this: real session management (list/revoke individual
 * logins) and new-device suspicious-login detection. All nullable -
 * no backfill, and no existing session becomes unusable for lacking
 * this context retroactively.
 */
export class AddSessionContextToRefreshToken1788500000000 implements MigrationInterface {
  name = 'AddSessionContextToRefreshToken1788500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "refresh_tokens" ADD "deviceFingerprint" character varying`);
    await queryRunner.query(`ALTER TABLE "refresh_tokens" ADD "ipAddress" character varying`);
    await queryRunner.query(`ALTER TABLE "refresh_tokens" ADD "userAgent" character varying`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "refresh_tokens" DROP COLUMN "userAgent"`);
    await queryRunner.query(`ALTER TABLE "refresh_tokens" DROP COLUMN "ipAddress"`);
    await queryRunner.query(`ALTER TABLE "refresh_tokens" DROP COLUMN "deviceFingerprint"`);
  }
}
