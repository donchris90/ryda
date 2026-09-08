import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSafetyRecordingsTable1791100000000 implements MigrationInterface {
  name = 'CreateSafetyRecordingsTable1791100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "safety_recordings" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "incidentId" character varying NOT NULL,
        "uploadedByUserId" character varying NOT NULL,
        "rideId" character varying,
        "audioUrl" character varying NOT NULL,
        "storageKey" character varying NOT NULL,
        "durationSeconds" integer,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "expiresAt" TIMESTAMP NOT NULL,
        CONSTRAINT "PK_safety_recordings_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_safety_recordings_incidentId" ON "safety_recordings" ("incidentId")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_safety_recordings_uploadedByUserId" ON "safety_recordings" ("uploadedByUserId")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_safety_recordings_expiresAt" ON "safety_recordings" ("expiresAt")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "safety_recordings"`);
  }
}
