import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds SLA tracking (dueAt, firstRespondedAt), payment context, and
 * message attachments to the support module. All nullable - no
 * backfill for existing tickets/messages, which never had this data.
 */
export class AddSupportSlaAndAttachments1788900000000 implements MigrationInterface {
  name = 'AddSupportSlaAndAttachments1788900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "support_tickets" ADD "paymentId" character varying`);
    await queryRunner.query(`ALTER TABLE "support_tickets" ADD "dueAt" TIMESTAMP`);
    await queryRunner.query(`ALTER TABLE "support_tickets" ADD "firstRespondedAt" TIMESTAMP`);
    await queryRunner.query(
      `CREATE INDEX "IDX_support_tickets_paymentId" ON "support_tickets" ("paymentId")`,
    );
    await queryRunner.query(`ALTER TABLE "ticket_messages" ADD "attachmentUrl" character varying`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "ticket_messages" DROP COLUMN "attachmentUrl"`);
    await queryRunner.query(`DROP INDEX "IDX_support_tickets_paymentId"`);
    await queryRunner.query(`ALTER TABLE "support_tickets" DROP COLUMN "firstRespondedAt"`);
    await queryRunner.query(`ALTER TABLE "support_tickets" DROP COLUMN "dueAt"`);
    await queryRunner.query(`ALTER TABLE "support_tickets" DROP COLUMN "paymentId"`);
  }
}
