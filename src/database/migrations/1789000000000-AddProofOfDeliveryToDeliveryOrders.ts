import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds proof-of-delivery fields to delivery_orders: photo/signature
 * URLs (linked after upload via the existing generic storage
 * endpoint), the recipient's name as actually given at handoff, and
 * GPS captured at the moment of delivery. All nullable - no backfill
 * for orders delivered before this existed.
 */
export class AddProofOfDeliveryToDeliveryOrders1789000000000 implements MigrationInterface {
  name = 'AddProofOfDeliveryToDeliveryOrders1789000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "delivery_orders" ADD "proofPhotoUrl" character varying`);
    await queryRunner.query(`ALTER TABLE "delivery_orders" ADD "proofSignatureUrl" character varying`);
    await queryRunner.query(`ALTER TABLE "delivery_orders" ADD "proofRecipientName" character varying`);
    await queryRunner.query(`ALTER TABLE "delivery_orders" ADD "proofDeliveryLat" double precision`);
    await queryRunner.query(`ALTER TABLE "delivery_orders" ADD "proofDeliveryLng" double precision`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "delivery_orders" DROP COLUMN "proofDeliveryLng"`);
    await queryRunner.query(`ALTER TABLE "delivery_orders" DROP COLUMN "proofDeliveryLat"`);
    await queryRunner.query(`ALTER TABLE "delivery_orders" DROP COLUMN "proofRecipientName"`);
    await queryRunner.query(`ALTER TABLE "delivery_orders" DROP COLUMN "proofSignatureUrl"`);
    await queryRunner.query(`ALTER TABLE "delivery_orders" DROP COLUMN "proofPhotoUrl"`);
  }
}
