import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds notifications.idempotencyKey - the enqueuing BullMQ job's own
 * id, when sent via the queue. Lets a retry of the same job (after a
 * partial failure - some channels already sent, one threw) tell
 * "already sent this channel for this event" apart from "genuinely
 * new", so a retry never re-sends a channel that already succeeded.
 * Nullable + indexed, not unique: several rows legitimately share one
 * key (one per channel in a multi-channel notify() call).
 */
export class AddIdempotencyKeyToNotification1788600000000 implements MigrationInterface {
  name = 'AddIdempotencyKeyToNotification1788600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "notifications" ADD "idempotencyKey" character varying`);
    await queryRunner.query(
      `CREATE INDEX "IDX_notifications_idempotencyKey" ON "notifications" ("idempotencyKey")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_notifications_idempotencyKey"`);
    await queryRunner.query(`ALTER TABLE "notifications" DROP COLUMN "idempotencyKey"`);
  }
}
