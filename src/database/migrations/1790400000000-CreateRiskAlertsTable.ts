import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * risk_alerts backs SafetyMonitoringService's pattern-based safety signals
 * (GPS staleness, excessive speed, route deviation, etc.) and the admin
 * Emergency Center's risk-alerts endpoints - fully wired into live code,
 * but the table itself was never created by any migration. Found by the
 * same full-entity audit that produced AddMissingTables earlier; this one
 * came later because RiskAlert wasn't yet flagged as a bare "column
 * missing" (a full-entity audit catches it as no table at all).
 */
export class CreateRiskAlertsTable1790400000000 implements MigrationInterface {
  name = 'CreateRiskAlertsTable1790400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."risk_alerts_type_enum" AS ENUM('gps_stale', 'excessive_speed', 'unusual_stop', 'route_deviation', 'trip_duration_anomaly', 'unexpected_termination');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."risk_alerts_status_enum" AS ENUM('open', 'reviewed', 'dismissed');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "risk_alerts" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "type" "public"."risk_alerts_type_enum" NOT NULL,
        "rideId" character varying,
        "driverUserId" character varying,
        "description" text NOT NULL,
        "details" jsonb,
        "lat" double precision,
        "lng" double precision,
        "status" "public"."risk_alerts_status_enum" NOT NULL DEFAULT 'open',
        "reviewedBy" character varying,
        "reviewNotes" character varying,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "reviewedAt" TIMESTAMP,
        CONSTRAINT "PK_risk_alerts_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_risk_alerts_rideId" ON "risk_alerts" ("rideId")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_risk_alerts_driverUserId" ON "risk_alerts" ("driverUserId")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_risk_alerts_status" ON "risk_alerts" ("status")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "risk_alerts"`);
    await queryRunner.query(`DROP TYPE "public"."risk_alerts_status_enum"`);
    await queryRunner.query(`DROP TYPE "public"."risk_alerts_type_enum"`);
  }
}
