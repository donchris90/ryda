import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Ride calling moved from Africa's Talking Voice (a proxied cellular
 * call, where this table tracked a providerSessionId + the callee's
 * real phone number for bridging) to in-app WebRTC (see
 * calls/calls.service.ts). Nothing phone-shaped belongs in this table
 * anymore, and the status lifecycle is different (ringing -> accepted
 * -> ongoing -> ended, or rejected/missed) since there's no longer a
 * telephony provider reporting call state to us — the two apps report
 * it themselves via TrackingGateway's call:* socket events.
 */
export class AlterCallLogsForWebrtc1791500000000 implements MigrationInterface {
  name = 'AlterCallLogsForWebrtc1791500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "call_logs" DROP COLUMN IF EXISTS "bridgeToPhone"`);
    await queryRunner.query(`ALTER TABLE "call_logs" DROP COLUMN IF EXISTS "providerSessionId"`);
    await queryRunner.query(`ALTER TABLE "call_logs" RENAME COLUMN "initiatedByUserId" TO "callerId"`);
    await queryRunner.query(`ALTER TABLE "call_logs" RENAME COLUMN "calleeUserId" TO "calleeId"`);
    await queryRunner.query(`ALTER TABLE "call_logs" ADD COLUMN IF NOT EXISTS "acceptedAt" TIMESTAMP`);
    await queryRunner.query(`ALTER TABLE "call_logs" ADD COLUMN IF NOT EXISTS "endedAt" TIMESTAMP`);

    await queryRunner.query(`ALTER TYPE "call_logs_status_enum" RENAME TO "call_logs_status_enum_old"`);
    await queryRunner.query(`CREATE TYPE "call_logs_status_enum" AS ENUM ('ringing', 'accepted', 'rejected', 'ongoing', 'ended', 'missed')`);
    await queryRunner.query(`
      ALTER TABLE "call_logs" ALTER COLUMN "status" DROP DEFAULT
    `);
    await queryRunner.query(`
      ALTER TABLE "call_logs" ALTER COLUMN "status" TYPE "call_logs_status_enum"
      USING (CASE "status"::text
        WHEN 'initiated' THEN 'ringing'
        WHEN 'bridged' THEN 'accepted'
        WHEN 'completed' THEN 'ended'
        WHEN 'failed' THEN 'missed'
        ELSE 'ringing'
      END)::"call_logs_status_enum"
    `);
    await queryRunner.query(`ALTER TABLE "call_logs" ALTER COLUMN "status" SET DEFAULT 'ringing'`);
    await queryRunner.query(`DROP TYPE "call_logs_status_enum_old"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "call_logs" RENAME COLUMN "callerId" TO "initiatedByUserId"`);
    await queryRunner.query(`ALTER TABLE "call_logs" RENAME COLUMN "calleeId" TO "calleeUserId"`);
    await queryRunner.query(`ALTER TABLE "call_logs" DROP COLUMN IF EXISTS "acceptedAt"`);
    await queryRunner.query(`ALTER TABLE "call_logs" DROP COLUMN IF EXISTS "endedAt"`);
    await queryRunner.query(`ALTER TABLE "call_logs" ADD COLUMN "providerSessionId" character varying`);
    await queryRunner.query(`ALTER TABLE "call_logs" ADD COLUMN "bridgeToPhone" character varying NOT NULL DEFAULT ''`);

    await queryRunner.query(`ALTER TYPE "call_logs_status_enum" RENAME TO "call_logs_status_enum_new"`);
    await queryRunner.query(`CREATE TYPE "call_logs_status_enum" AS ENUM ('initiated', 'ringing', 'bridged', 'completed', 'failed')`);
    await queryRunner.query(`ALTER TABLE "call_logs" ALTER COLUMN "status" DROP DEFAULT`);
    await queryRunner.query(`
      ALTER TABLE "call_logs" ALTER COLUMN "status" TYPE "call_logs_status_enum"
      USING (CASE "status"::text
        WHEN 'ringing' THEN 'initiated'
        WHEN 'accepted' THEN 'bridged'
        WHEN 'ongoing' THEN 'bridged'
        WHEN 'ended' THEN 'completed'
        WHEN 'missed' THEN 'failed'
        WHEN 'rejected' THEN 'failed'
        ELSE 'initiated'
      END)::"call_logs_status_enum"
    `);
    await queryRunner.query(`ALTER TABLE "call_logs" ALTER COLUMN "status" SET DEFAULT 'initiated'`);
    await queryRunner.query(`DROP TYPE "call_logs_status_enum_new"`);
  }
}
