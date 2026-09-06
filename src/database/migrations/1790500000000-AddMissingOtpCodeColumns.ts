import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Same class of bug as AddMissingRideColumns, found the same way (entity
 * vs. migration audit) but on a table that had somehow been missed before:
 * otp_codes.purpose and otp_codes.attemptCount exist on OtpCode
 * (src/otp/otp-code.entity.ts) but were never part of InitialSchema or any
 * later migration. Every OtpService.send() call does an INSERT that
 * includes `purpose`, so this has been failing with
 * `column "purpose" of relation "otp_codes" does not exist` for every OTP
 * send/verify since the entity fields were added - which breaks phone
 * verification, and (per OtpPurpose's WALLET_TRANSFER/WALLET_WITHDRAWAL
 * values) very likely OTP-confirmed wallet transfers and withdrawals too.
 */
export class AddMissingOtpCodeColumns1790500000000 implements MigrationInterface {
  name = 'AddMissingOtpCodeColumns1790500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."otp_codes_purpose_enum" AS ENUM('phone_verification', 'wallet_transfer', 'wallet_withdrawal')`,
    );
    await queryRunner.query(
      `ALTER TABLE "otp_codes" ADD "purpose" "public"."otp_codes_purpose_enum" NOT NULL DEFAULT 'phone_verification'`,
    );
    await queryRunner.query(
      `ALTER TABLE "otp_codes" ADD "attemptCount" integer NOT NULL DEFAULT 0`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "otp_codes" DROP COLUMN "attemptCount"`);
    await queryRunner.query(`ALTER TABLE "otp_codes" DROP COLUMN "purpose"`);
    await queryRunner.query(`DROP TYPE "public"."otp_codes_purpose_enum"`);
  }
}
