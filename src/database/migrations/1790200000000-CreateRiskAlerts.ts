import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates risk_alerts, backing SafetyMonitoringService (GET/PATCH
 * admin/emergency/risk-alerts and emergency/rides/:rideId/risk-alerts).
 * The RiskAlert entity (emergency/entities/risk-alert.entity.ts) has
 * existed and been queried by live code with no CREATE TABLE migration
 * anywhere in the repo - missed by the AddMissingTables1790000000000
 * audit that caught the other undeclared tables (loyalty_accounts,
 * bank_accounts, withdrawal_requests, etc). Every call into this table
 * fails with Postgres 42P01 (relation does not exist) until this runs.
 */
export class CreateRiskAlerts1790200000000 implements MigrationInterface {
  name = 'CreateRiskAlerts1790200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."risk_alerts_type_enum" AS ENUM(
        'gps_stale', 'excessive_speed', 'unusual_stop', 'route_deviation',
        'trip_duration_anomaly', 'unexpected_termination'
      )`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."risk_alerts_status_enum" AS ENUM('open', 'reviewed', 'dismissed')`,
    );
    await queryRunner.query(`
      CREATE TABLE "risk_alerts" (
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
    await queryRunner.query(`CREATE INDEX "IDX_risk_alerts_rideId" ON "risk_alerts" ("rideId")`);
    await queryRunner.query(`CREATE INDEX "IDX_risk_alerts_driverUserId" ON "risk_alerts" ("driverUserId")`);
    await queryRunner.query(`CREATE INDEX "IDX_risk_alerts_status" ON "risk_alerts" ("status")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_risk_alerts_status"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_risk_alerts_driverUserId"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_risk_alerts_rideId"`);
    await queryRunner.query(`DROP TABLE "risk_alerts"`);
    await queryRunner.query(`DROP TYPE "public"."risk_alerts_status_enum"`);
    await queryRunner.query(`DROP TYPE "public"."risk_alerts_type_enum"`);
  }
}
