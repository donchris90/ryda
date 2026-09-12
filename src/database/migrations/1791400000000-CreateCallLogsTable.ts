import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCallLogsTable1791400000000 implements MigrationInterface {
  name = 'CreateCallLogsTable1791400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "call_logs_status_enum" AS ENUM ('initiated', 'ringing', 'bridged', 'completed', 'failed')
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "call_logs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "rideId" character varying NOT NULL,
        "initiatedByUserId" character varying NOT NULL,
        "calleeUserId" character varying NOT NULL,
        "providerSessionId" character varying,
        "bridgeToPhone" character varying NOT NULL,
        "status" "call_logs_status_enum" NOT NULL DEFAULT 'initiated',
        "durationSeconds" integer,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_call_logs_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_call_logs_rideId" ON "call_logs" ("rideId")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_call_logs_providerSessionId" ON "call_logs" ("providerSessionId")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "call_logs"`);
    await queryRunner.query(`DROP TYPE "call_logs_status_enum"`);
  }
}
