import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * incidents.severity (enum: low/medium/high/critical, default 'medium')
 * has been declared on the Incident entity since it was written, but was
 * never added by any migration - not in InitialSchema's CREATE TABLE, and
 * not by AddMissingColumnsOnExistingTables1790100000000, which patched
 * this same table's respondingBy/escalatedBy/escalationReason/escalatedAt
 * gap but missed this one.
 *
 * Easy to miss because "severity" already exists as a column name
 * elsewhere - fraud_flags.severity (InitialSchema) - which reads as
 * "already covered" but is a different table entirely; incidents needs
 * its own severity for the same reason EmergencyService.triggerSos()
 * forces it to 'critical' and responders can raise it while investigating.
 *
 * Effect until this runs: every read or write of an Incident row (report,
 * list active/all, acknowledge, respond, escalate, resolve, force-cancel)
 * selects or inserts this column and fails with Postgres 42703 (column
 * does not exist) - i.e. the whole Emergency Center admin page.
 */
export class AddSeverityToIncidents1790500000000 implements MigrationInterface {
  name = 'AddSeverityToIncidents1790500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."incidents_severity_enum" AS ENUM('low', 'medium', 'high', 'critical');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'incidents' AND column_name = 'severity'
        ) THEN
          ALTER TABLE "incidents" ADD "severity" "public"."incidents_severity_enum" NOT NULL DEFAULT 'medium';
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "incidents" DROP COLUMN "severity"`);
    await queryRunner.query(`DROP TYPE "public"."incidents_severity_enum"`);
  }
}
