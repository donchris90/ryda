import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds real COD (cash-on-delivery) collection tracking - previously
 * only the expected amount (codAmount) existed anywhere in the
 * schema; what the driver actually collected, whether it fell short,
 * and whether an admin has reconciled a shortfall were all absent.
 */
export class AddCodCollectionTrackingToDeliveryOrders1789100000000 implements MigrationInterface {
  name = 'AddCodCollectionTrackingToDeliveryOrders1789100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."delivery_orders_codcollectionstatus_enum" AS ENUM('collected', 'partial', 'failed')`,
    );
    await queryRunner.query(`ALTER TABLE "delivery_orders" ADD "codCollectedAmount" numeric(10,2)`);
    await queryRunner.query(
      `ALTER TABLE "delivery_orders" ADD "codCollectionStatus" "public"."delivery_orders_codcollectionstatus_enum"`,
    );
    await queryRunner.query(`ALTER TABLE "delivery_orders" ADD "codReconciledAt" TIMESTAMP`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "delivery_orders" DROP COLUMN "codReconciledAt"`);
    await queryRunner.query(`ALTER TABLE "delivery_orders" DROP COLUMN "codCollectionStatus"`);
    await queryRunner.query(`ALTER TABLE "delivery_orders" DROP COLUMN "codCollectedAmount"`);
    await queryRunner.query(`DROP TYPE "public"."delivery_orders_codcollectionstatus_enum"`);
  }
}
