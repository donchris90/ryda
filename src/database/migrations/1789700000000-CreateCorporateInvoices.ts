import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCorporateInvoices1789700000000 implements MigrationInterface {
  name = 'CreateCorporateInvoices1789700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "corporate_invoices" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "corporateAccountId" uuid NOT NULL,
        "periodStart" TIMESTAMPTZ NOT NULL,
        "periodEnd" TIMESTAMPTZ NOT NULL,
        "openingBalance" decimal(14,2) NOT NULL,
        "closingBalance" decimal(14,2) NOT NULL,
        "totalDebits" decimal(14,2) NOT NULL,
        "totalCredits" decimal(14,2) NOT NULL,
        "transactionCount" integer NOT NULL,
        "currency" character varying NOT NULL DEFAULT 'NGN',
        "generatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_corporate_invoices_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_corporate_invoices_account" ON "corporate_invoices" ("corporateAccountId")`);
    // One invoice per account per exact period - the same uniqueness
    // guarantee CorporateService.generateInvoiceForPeriod() relies on
    // to be safely re-run (by the monthly cron, or a manual admin
    // trigger) without ever producing a duplicate statement for the
    // same month.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_corporate_invoices_account_period" ON "corporate_invoices" ("corporateAccountId", "periodStart", "periodEnd")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "corporate_invoices"`);
  }
}
