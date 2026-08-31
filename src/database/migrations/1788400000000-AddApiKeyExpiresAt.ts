import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Admin API key management (Batch 4) wants a real expiry option, not just
 * revoke — partners are sometimes issued time-boxed keys for a pilot or
 * trial integration. Nullable, so every existing key keeps working with
 * no expiry (opt-in only, no behavior change for keys already in use).
 */
export class AddApiKeyExpiresAt1788400000000 implements MigrationInterface {
    name = 'AddApiKeyExpiresAt1788400000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "api_keys" ADD "expiresAt" TIMESTAMP`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "api_keys" DROP COLUMN "expiresAt"`);
    }

}
