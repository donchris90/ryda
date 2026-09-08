import { MigrationInterface, QueryRunner } from 'typeorm';

export class MakeUsersPhoneNullable1791200000000 implements MigrationInterface {
  name = 'MakeUsersPhoneNullable1791200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "phone" DROP NOT NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Deliberately a no-op, not a real reversal - by the time this
    // migration has been live for any length of time, there will very
    // likely be real user rows with phone IS NULL (exactly the case
    // this migration exists to allow). Re-adding NOT NULL would fail
    // outright against any such row, and silently backfilling a fake
    // phone number to force it through would be worse.
  }
}
