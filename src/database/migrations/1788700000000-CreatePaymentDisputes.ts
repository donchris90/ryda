import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates payment_disputes - tracks Paystack chargebacks/disputes
 * (charge.dispute.create/.remind/.resolve webhooks) against payments,
 * keyed by Paystack's own dispute id so a reminder or a replayed
 * webhook updates the same row rather than duplicating it.
 */
export class CreatePaymentDisputes1788700000000 implements MigrationInterface {
  name = 'CreatePaymentDisputes1788700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."payment_disputes_status_enum" AS ENUM('awaiting-merchant-feedback', 'awaiting-bank-feedback', 'pending', 'resolved')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."payment_disputes_resolution_enum" AS ENUM('merchant-accepted', 'declined')`,
    );
    await queryRunner.query(
      `CREATE TABLE "payment_disputes" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "paystackDisputeId" character varying NOT NULL,
        "paymentReference" character varying NOT NULL,
        "userId" character varying,
        "amount" numeric(10,2) NOT NULL,
        "status" "public"."payment_disputes_status_enum" NOT NULL DEFAULT 'awaiting-merchant-feedback',
        "resolution" "public"."payment_disputes_resolution_enum",
        "reason" character varying,
        "dueAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_payment_disputes_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_payment_disputes_paystackDisputeId" ON "payment_disputes" ("paystackDisputeId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_payment_disputes_paymentReference" ON "payment_disputes" ("paymentReference")`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_payment_disputes_userId" ON "payment_disputes" ("userId")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_payment_disputes_userId"`);
    await queryRunner.query(`DROP INDEX "IDX_payment_disputes_paymentReference"`);
    await queryRunner.query(`DROP INDEX "IDX_payment_disputes_paystackDisputeId"`);
    await queryRunner.query(`DROP TABLE "payment_disputes"`);
    await queryRunner.query(`DROP TYPE "public"."payment_disputes_resolution_enum"`);
    await queryRunner.query(`DROP TYPE "public"."payment_disputes_status_enum"`);
  }
}
