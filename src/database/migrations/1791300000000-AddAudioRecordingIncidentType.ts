import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Same class of enum-drift fix as AddMissingIncidentStatusEnumValues:
 * IncidentType (src/emergency/entities/incident.entity.ts) gained a new
 * AUDIO_RECORDING value for the passenger app's rider-initiated in-trip
 * audio recording feature (a manual toggle on the ride tracking screen,
 * not gated behind SOS - see EmergencyService.startAudioRecording()),
 * but the Postgres enum type itself needs its own migration to accept it.
 *
 * ALTER TYPE ... ADD VALUE can't run inside the same transaction as
 * other statements, which is satisfied here since this migration does
 * nothing else.
 */
export class AddAudioRecordingIncidentType1791300000000 implements MigrationInterface {
  name = 'AddAudioRecordingIncidentType1791300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."incidents_type_enum" ADD VALUE IF NOT EXISTS 'audio_recording'`,
    );
  }

  public async down(): Promise<void> {
    // Postgres has no DROP VALUE for enum types - see
    // AddMissingIncidentStatusEnumValues's down() for the same reasoning.
  }
}
