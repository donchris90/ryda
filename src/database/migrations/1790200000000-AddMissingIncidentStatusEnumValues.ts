import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Enum drift on incidents.status - a different flavor of the same class
 * of bug as AddMissingRideColumns/AddMissingTables, caught by a production
 * error this time rather than the entity-vs-migration audit: `invalid
 * input value for enum incidents_status_enum: "responding"`.
 *
 * IncidentStatus (src/emergency/entities/incident.entity.ts) has always
 * included RESPONDING and ESCALATED, and EmergencyService.respond()/
 * escalate() have always set those statuses - but InitialSchema only ever
 * created the Postgres enum type with `('open', 'acknowledged', 'resolved',
 * 'closed')`. No migration since has added the other two values. So
 * `respond()` (used by the admin Emergency Center's "Respond" action) and
 * `escalate()` (its "Escalate" action) have been broken since the initial
 * migration - every attempt to move an incident into either status fails
 * with exactly this Postgres error, and any query filtering/loading rows
 * already sitting in one of these unrecognized statuses would too.
 *
 * Postgres requires ALTER TYPE ... ADD VALUE to not be used in the same
 * transaction that adds it, which is satisfied here since this migration
 * does nothing else.
 */
export class AddMissingIncidentStatusEnumValues1790200000000 implements MigrationInterface {
  name = 'AddMissingIncidentStatusEnumValues1790200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."incidents_status_enum" ADD VALUE IF NOT EXISTS 'responding'`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."incidents_status_enum" ADD VALUE IF NOT EXISTS 'escalated'`,
    );
  }

  public async down(): Promise<void> {
    // Postgres has no DROP VALUE for enum types - removing a value
    // requires rebuilding the type (create new type, cast every column
    // over, drop the old type, rename). Not attempted here: doing that
    // safely would require knowing no existing row uses 'responding' or
    // 'escalated', which this migration can't assume, and getting it
    // wrong risks data loss on a safety-incident table. If a genuine
    // rollback is ever needed, handle it manually with that in mind.
  }
}
